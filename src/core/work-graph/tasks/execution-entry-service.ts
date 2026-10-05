/**
 * B2 WorkGraph execution-entry service.
 *
 * One shared trusted-admission helper is the ONLY place that binds a Host
 * context, isolates a request, re-reads the formal Run/Attempt/outbox/Plan/
 * Session/Lease facts, re-reads the saved Prepared manifest body and re-checks
 * the current Host configuration and role resolution. `execution-entry-service`
 * and `model-call-service` both use it; the model lane never copies a second
 * authorization algorithm.
 *
 * Ordering invariant: every method looks up the ORIGINAL idempotency receipt
 * first, so a replay restores the original result from the recorded event and
 * never re-reads the later Run. A fresh write compiles exactly ONE
 * `PreparedCommit` with all local guards actually used and the caller's exact
 * Run pin; no ledger horizon and no global workspace gate.
 *
 * The four lifecycle writes are decided by the pure Run machine
 * (`state/run-machine.ts`, STATE-MACHINES-SPEC §6): authorize is RUN-02, begin
 * RUN-04, entered RUN-05 and the result RUN-07. Each asks the machine after the
 * execution read, and authorize/begin again after each later read with the
 * facts read so far (a fact not read yet holds), so a refused guard stops the
 * reads where they always stopped. The accepted `next.record` is the Run
 * written; its effects become the Attempt, Outbox and Lease
 * (`state/attempt-machine.ts`, ATT-02/06/18/26/27), the Session release
 * (`state/session-availability.ts`, SES-04) and the Kernel identity slot of
 * the same commit. The model barrier (`admitEnteredRun`) asks the same
 * machine's V2 binding, persisted claim, permit and claim Session/Lease guards.
 */
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize, type ArtifactRecord, type ArtifactRef } from '../../../contracts/artifact.js';
import type {
  ExecutionAuthorizationV2, RoleBindingRefV1, RunRef, RunSnapshot,
  RuntimeInputBindingV1, TaskAttemptSnapshot, TaskBudgetV1, TaskLeaseSnapshot, TaskTriple,
} from '../../../contracts/dispatch.js';
import { continuationBriefShapeProblem } from '../../../contracts/continuation-brief.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { sameArtifactRef, validMaterialSourcePin, type MaterialBasisV1 } from '../../../contracts/material-access.js';
import { MANIFEST_CONTENT_TYPE } from '../../../contracts/no-progress.js';
import type { PlanRevisionSnapshot, TaskInputRequirementV2 } from '../../../contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import type { RawArtifactRecord } from '../../record-store/body-ports.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreFailure,
  UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RoleBindingFacts } from '../configuration/contracts.js';
import type { MaterialReadFacts } from '../materials/contracts.js';
import {
  EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE, EXECUTION_ENTRY_BEGUN_EVENT_TYPE,
  EXECUTION_ENTRY_ENTERED_EVENT_TYPE, EXECUTION_ENTRY_EVENT_SCHEMA_VERSION,
  EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE,
  encodeExecutionEntryAuthorizedEvent, encodeExecutionEntryBegunEvent,
  encodeExecutionEntryEnteredEvent, encodeExecutionRunResultRecordedEvent,
  executionEntryAuthorizedEventFromEvent, executionEntryBegunEventFromEvent,
  executionEntryEnteredEventFromEvent, executionRunResultRecordedEventFromEvent,
  inputBindingProblem, taskDispatchStateV1Problem,
} from '../persistence/execution-entry-codecs.js';
import { encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import {
  attemptEventFromRunEvent, isTaskLeaseEvent, taskLeaseNodeOf, transitionAttempt, transitionDispatchOutbox,
  transitionTaskLease, type AttemptEvent, type AttemptGuardContext, type DispatchOutboxRecord, type RunEventForAttempt,
} from '../state/attempt-machine.js';
import {
  claimHoldGuard, entryPermitGuard, entryV2Binding, leaseOwnedByRun, permitClaimGuard, runControlFence, runStateOf, transitionRun,
  type RunEffect, type RunEvent, type RunGuardContext, type RunState, type RunTransition,
} from '../state/run-machine.js';
import {
  ownsOccupancy, releaseSessionRecord, sessionMachineStateOf, transitionSession,
  type SessionGuardContext, type SessionRelease, type SessionReleaseCause,
} from '../state/session-availability.js';
import type { Rejected as MachineRefusal } from '../state/transition.js';
import {
  dispatchOutboxRefKey, encodeDispatchOutboxEntry, encodeTaskAttemptSnapshot, taskAttemptRefKey, taskClaimProblem,
} from './claim-record-codecs.js';
import type { GraphWrite } from './contracts.js';
import type {
  AuthorizeConfigurationResult, ExecutionEntryDependencies, ExecutionEntryPort, KernelExecutionBinding,
  KernelObservationSource, ObservedExecutionHistory, RuntimeEntryRecord, TaskEntryPermit, TaskResultObservation,
} from './execution-entry-contracts.js';
import type { TaskExecutionRecord } from './execution-read-contracts.js';
import { readGoalScope, sameCursor } from './plan-readers.js';
import { planRevisionRefKey } from './plan-record-codecs.js';

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

type HostActor = { kind: 'human' | 'system'; id: string };
type Rejected = { ok: false; rejection: CoreRejection };
type OwnedContext = { ok: true; ctx: CoreCallContext; scope: WorkspaceScope; actor: HostActor; signal: AbortSignal };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function busy(reason: string): CoreRejection { return reject('busy', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
export function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
function refKeyOf(value: object): string | null {
  try { return canonicalJson(value as unknown as JsonValue); } catch { return null; }
}
function parseJsonObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch { return null; }
}
function pinsFromCurrent(current: readonly { refKey: string; revision: number | null }[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    try {
      const ref = JSON.parse(entry.refKey) as unknown;
      if (isRecord(ref)) pins.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
    } catch { /* an unreadable ref key is not a pin */ }
  }
  return pins;
}
export function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': {
      const current = pinsFromCurrent(failure.current);
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict': return busy(`${failure.reason} (the Kernel identity slot is held by another Run)`);
    case 'idempotency_conflict': return reject('idempotency_conflict', failure.reason);
    case 'not_found': return notFound(failure.reason);
    case 'invalid': return invalid(failure.reason);
    case 'unsupported': return unavailable(failure.reason);
    default: return unavailable(failure.reason);
  }
}
function mapReadResult<T>(result: Exclude<ReadResult<T>, { status: 'ready' }>): CoreRejection {
  if (result.status === 'not_found') return notFound('the requested record does not exist');
  if (result.status === 'not_ready') return incomplete('the read is not ready at the required watermark');
  return result;
}

// The ONE shared fresh-action barrier against the Run's control pointer is the
// Run machine's `runControlFence` (`state/run-machine.ts`), called at exactly
// three audited points: after the execution read in `authorizeRuntimeEntry` and
// `beginRuntimeEntry` (RUN-02/04's first guard, asked before the cancellation
// check), and after the facts read in the shared `admitEnteredRun` (both model
// barriers). It is deliberately NOT in `readAdmissionFacts`, because
// entered/result re-reads must stay free of it.
function sameKernel(left: KernelExecutionBinding, right: KernelExecutionBinding): boolean {
  return left.adapterId === right.adapterId && left.kernelSessionId === right.kernelSessionId
    && left.runId === right.runId && left.turnId === right.turnId;
}
function isKernelBinding(value: unknown): value is KernelExecutionBinding {
  return isRecord(value) && nonEmpty(value['adapterId']) && nonEmpty(value['kernelSessionId'])
    && nonEmpty(value['runId']) && nonEmpty(value['turnId']);
}
function isKernelObservationSource(value: unknown): value is KernelObservationSource {
  return isKernelBinding(value) && isPositiveSafeInteger((value as { position?: unknown }).position);
}
function isRoleBinding(value: unknown): value is RoleBindingRefV1 {
  return isRecord(value) && value['schemaVersion'] === 1 && nonEmpty(value['bindingId'])
    && nonEmpty(value['templateId']) && nonEmpty(value['templateRevision'])
    && isPositiveSafeInteger(value['bindingVersion']) && nonEmpty(value['policyRevision']);
}
function isWorkspacePin(value: unknown): value is { workspaceId: string; revision: number } {
  return isRecord(value) && nonEmpty(value['workspaceId']) && isSafeInteger(value['revision']);
}
function isPermissions(value: unknown): value is TaskEnvelopeV1['permissions'] {
  return isRecord(value) && nonEmpty(value['policyRevision'])
    && Array.isArray(value['tools']) && value['tools'].every(nonEmpty)
    && Array.isArray(value['writeScope']) && value['writeScope'].every(nonEmpty);
}
function isBudget(value: unknown): value is TaskBudgetV1 {
  return isRecord(value) && isPositiveSafeInteger(value['tokenBudget'])
    && (value['deadline'] === null || nonEmpty(value['deadline']));
}
function goalRefOf(task: TaskTriple): GoalRef {
  return { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
}

// --------------------------------------------------------------------------
// Trusted Host context and request isolation
// --------------------------------------------------------------------------

function sameHostActor(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left['kind'] === right['kind'] && left['id'] === right['id']
    && (left['kind'] === 'human' || left['kind'] === 'system');
}

export function bindTrustedContext(ctx: CoreCallContext): OwnedContext | Rejected {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) return { ok: false, rejection: invalid('a B2 execution write requires a bound call context') };
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: forbidden('a B2 execution write requires a bound project/workspace context') };
  }
  const signal = raw.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean' || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: forbidden('a B2 execution write requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return { ok: false, rejection: invalid('the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: forbidden('a B2 execution write requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: forbidden('a B2 execution write requires a trusted Host actor') };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)
    || !sameHostActor(materialReader['actor'], actor)) {
    return { ok: false, rejection: forbidden('the material reader is not the same trusted Host scope') };
  }
  return {
    ok: true,
    ctx: { projectId, workspaceId, principal: principal as CoreCallContext['principal'],
      materialReader: materialReader as MaterialReader, signal: signal as unknown as AbortSignal },
    scope: { projectId, workspaceId },
    actor: { kind: actor['kind'], id: actor['id'] },
    signal: signal as unknown as AbortSignal,
  };
}

type OwnedWrite<T> = { ok: true; input: T; requestId: string; expected: readonly VersionPin[] } | Rejected;

export function isolateWrite<T>(request: GraphWrite<T>): OwnedWrite<T> {
  const raw = request as unknown as { input?: unknown; meta?: unknown } | null | undefined;
  if (raw === null || raw === undefined || !isRecord(raw.input)) {
    return { ok: false, rejection: invalid('a B2 execution write requires a request input object') };
  }
  const meta = raw.meta;
  if (!isRecord(meta) || !nonEmpty(meta['requestId'])) {
    return { ok: false, rejection: invalid('a B2 execution write requires meta.requestId') };
  }
  if (!Array.isArray(meta['expected'])) {
    return { ok: false, rejection: invalid('meta.expected must be an array of version pins') };
  }
  let input: T;
  let expected: readonly VersionPin[];
  try {
    input = structuredClone(raw.input) as T;
    expected = structuredClone(meta['expected']) as VersionPin[];
  } catch {
    return { ok: false, rejection: invalid('the B2 execution request cannot be isolated from the caller') };
  }
  return { ok: true, input, requestId: meta['requestId'], expected };
}

export function checkRunPin(expected: readonly VersionPin[], runRef: RunRef): { ok: true; pin: VersionPin } | Rejected {
  if (expected.length !== 1) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly one Run revision pin') };
  }
  const raw = expected[0] as unknown;
  if (!isRecord(raw) || !isRecord(raw['ref']) || !isPositiveSafeInteger(raw['revision'])) {
    return { ok: false, rejection: invalid('the expected Run pin must carry a ref and a positive safe revision') };
  }
  if (!sameRef(raw['ref'], runRef)) {
    return { ok: false, rejection: invalid('meta.expected must pin exactly the target Run') };
  }
  return { ok: true, pin: { ref: raw['ref'] as VersionPin['ref'], revision: raw['revision'] } };
}

/** Exactly the Run pin plus the permit ref at revision 1, and nothing else. */
export function checkRunAndPermitPins(
  expected: readonly VersionPin[],
  runRef: RunRef,
  permitRef: { aggregateType: 'ModelRequestPermit'; projectId: string; workspaceId: string; permitId: string },
): { ok: true; runPin: VersionPin } | Rejected {
  if (expected.length !== 2) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly the Run pin and the permit@1 pin') };
  }
  const runPin = expected.find(pin => sameRef(pin.ref, runRef));
  const permitPin = expected.find(pin => sameRef(pin.ref, permitRef));
  if (runPin === undefined || permitPin === undefined || runPin === permitPin) {
    return { ok: false, rejection: invalid('meta.expected must be the Run and permit pins without extras') };
  }
  if (!isPositiveSafeInteger(runPin.revision) || permitPin.revision !== 1) {
    return { ok: false, rejection: invalid('the permit pin must be revision 1 and the Run pin a positive revision') };
  }
  return { ok: true, runPin };
}

// --------------------------------------------------------------------------
// Admission reads shared with the model lane
// --------------------------------------------------------------------------

export async function readAdmissionFacts(
  deps: Pick<ExecutionEntryDependencies, 'reads' | 'records'>,
  ctx: CoreCallContext,
  runRef: RunRef,
  expectedPin: VersionPin,
): Promise<{ ok: true; value: TaskExecutionRecord } | Rejected> {
  const read = await deps.reads.readExecution(ctx, runRef);
  if (read.status === 'not_found') return { ok: false, rejection: notFound('the target Run does not exist') };
  if (read.status === 'not_ready') return { ok: false, rejection: incomplete('the target Run is not readable at the required watermark') };
  if (read.status !== 'ready') return { ok: false, rejection: reject(read.code, read.reason, read.current) };
  if (read.value.run.revision !== expectedPin.revision) {
    return { ok: false, rejection: reject('revision_conflict', 'the Run changed since the caller read it') };
  }
  return { ok: true, value: read.value };
}

export type StoredManifest = { manifest: PreparedTaskManifestV1; bodyDigest: string };

export async function readStoredManifest(
  deps: Pick<ExecutionEntryDependencies, 'bodies'>,
  run: RunSnapshot,
): Promise<{ ok: true; value: StoredManifest } | Rejected> {
  const envelope = run.envelope;
  if (!isRecord(envelope)) {
    return { ok: false, rejection: forbidden('the Run has no saved prepared manifest reference') };
  }
  return readManifestFromEnvelope(deps, envelope, run.ref);
}

function originOwnerRunRefMatches(origin: unknown, ownerRunRef: RunRef): boolean {
  if (!isRecord(origin) || origin['kind'] !== 'run') return false;
  const owner = origin['owner'];
  return isRecord(owner) && owner['aggregateType'] === 'Run'
    && owner['projectId'] === ownerRunRef.projectId && owner['goalId'] === ownerRunRef.goalId
    && owner['runId'] === ownerRunRef.runId;
}

function sourceRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !['plan-revision', 'workspace', 'governance', 'artifact', 'memory'].includes(value['kind'] as string)) {
    return 'provenance sourceRefs entries must be complete SourceRefV1 values';
  }
  if (!nonEmpty(value['refId']) || !nonEmpty(value['revision'])) return 'provenance sourceRefs entries are incomplete';
  if (value['digest'] !== undefined && typeof value['digest'] !== 'string') return 'provenance sourceRefs digest must be a string';
  return null;
}

/**
 * The ONE reusable prepared-manifest parser. It verifies the exact content
 * type, the bounded size, the stored ref/body bytes/size/digest, the original
 * Run owner provenance and the strict manifest DTO before returning a
 * `PreparedTaskManifestV1`. No second manifest library exists.
 */
export async function readManifestFromEnvelope(
  deps: Pick<ExecutionEntryDependencies, 'bodies'>,
  envelope: Record<string, unknown>,
  ownerRunRef: RunRef,
): Promise<{ ok: true; value: StoredManifest } | Rejected> {
  if (!isArtifactRef(envelope['bundleRef'])) {
    return { ok: false, rejection: forbidden('the prepared manifest has no artifact reference') };
  }
  const ref = envelope['bundleRef'] as ArtifactRef;
  if (ref.contentType !== MANIFEST_CONTENT_TYPE) {
    return { ok: false, rejection: forbidden('the prepared manifest content type is not the frozen task-execution manifest type') };
  }
  if (ref.sizeBytes > ARTIFACT_MAX_SIZE_BYTES) {
    return { ok: false, rejection: forbidden('the prepared manifest exceeds the bounded artifact size') };
  }
  const stored = await deps.bodies.read(ref);
  if (stored.status !== 'ready') return { ok: false, rejection: mapStoreFailure(stored) };
  const record: RawArtifactRecord = stored.value;
  if (!sameArtifactRef(record.ref, ref)) return { ok: false, rejection: unavailable('the stored manifest ref disagrees with the envelope') };
  if (artifactBodyDigest(record.body) !== ref.digest) return { ok: false, rejection: unavailable('the stored manifest body digest disagrees with its reference') };
  if (artifactBodySize(record.body) !== ref.sizeBytes) return { ok: false, rejection: unavailable('the stored manifest body size disagrees with its reference') };
  if (artifactBodySize(record.body) > ARTIFACT_MAX_SIZE_BYTES) {
    return { ok: false, rejection: forbidden('the stored manifest exceeds the bounded artifact size') };
  }
  if (!originOwnerRunRefMatches(record.origin, ownerRunRef)) {
    return { ok: false, rejection: forbidden('the stored manifest provenance owner is not the authorized Run') };
  }
  if (!Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0) {
    return { ok: false, rejection: unavailable('the stored manifest has no provenance source set') };
  }
  for (const source of record.sourceRefs) {
    const problem = sourceRefProblem(source);
    if (problem !== null) return { ok: false, rejection: unavailable(problem) };
  }
  const parsed = parseJsonObject(record.body);
  if (parsed === null) return { ok: false, rejection: unavailable('the stored manifest body is not a JSON object') };
  const problem = manifestProblem(parsed);
  if (problem !== null) return { ok: false, rejection: unavailable(`the stored prepared manifest is malformed: ${problem}`) };
  return { ok: true, value: { manifest: parsed as unknown as PreparedTaskManifestV1, bodyDigest: ref.digest } };
}

function roleResolutionProblem(role: unknown): string | null {
  if (!isRecord(role)) return 'manifest role must be a RoleSpecResolutionV1 object';
  if (role['status'] === 'resolved') {
    if (!nonEmpty(role['roleId'])) return 'a resolved role requires a roleId';
    const revision = role['revision'];
    if (!isRecord(revision) || !nonEmpty(revision['roleId']) || !isPositiveSafeInteger(revision['revision'])) {
      return 'a resolved role requires a complete RoleSpecRevisionRef';
    }
    if (!isRecord(role['spec'])) return 'a resolved role requires a RoleSpecContent object';
    return null;
  }
  if (role['status'] === 'absent') {
    if (!nonEmpty(role['roleId']) || typeof role['reason'] !== 'string') return 'an absent role requires roleId and reason';
    return null;
  }
  if (role['status'] === 'inadmissible') {
    if (!nonEmpty(role['roleId']) || !Array.isArray(role['reasons'])) return 'an inadmissible role requires roleId and reasons';
    return null;
  }
  return 'manifest role status is not recognized';
}

function planRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'PlanRevision'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'materialBasis planRef must be a complete PlanRevisionRef';
  }
  return null;
}
function materialBasisProblem(basis: unknown): string | null {
  if (basis === null) return null;
  if (!isRecord(basis)) return 'manifest materialBasis must be null or a MaterialBasisV1 object';
  if (basis['planRef'] !== null && planRefProblem(basis['planRef']) !== null) return 'materialBasis planRef is invalid';
  if (basis['workspaceRevision'] !== null
    && !(typeof basis['workspaceRevision'] === 'number' && Number.isSafeInteger(basis['workspaceRevision']) && basis['workspaceRevision'] >= 0)) {
    return 'materialBasis workspaceRevision must be null or a safe non-negative integer';
  }
  if (basis['sourceDigest'] !== null && typeof basis['sourceDigest'] !== 'string') return 'materialBasis sourceDigest must be null or a string';
  if (basis['sourcePin'] !== undefined && !validMaterialSourcePin(basis['sourcePin'])) return 'materialBasis sourcePin is not a valid MaterialSourcePinV1';
  return null;
}
function materialGrantRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'MaterialAccessGrant'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['grantId'])) {
    return 'manifest materialAccessRefs entries must be complete MaterialAccessGrantRefs';
  }
  return null;
}
function deliveryPinProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Delivery'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId']) || !nonEmpty(value['deliveryId'])) {
    return 'manifest deliveryRefs entries must be complete ModelRequestMaterialPinV1 values';
  }
  return null;
}
function sessionRoleProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'manifest sessionRole must be an object';
  if (value['kind'] === 'legacy_template') {
    if (!nonEmpty(value['templateId']) || !nonEmpty(value['templateRevision'])) return 'a legacy sessionRole requires templateId and templateRevision';
    return null;
  }
  if (value['kind'] === 'role_spec') {
    if (!isRecord(value['pin'])) return 'a role_spec sessionRole requires a pin';
    return null;
  }
  return 'manifest sessionRole kind is not recognized';
}
/** LA-1 `sessionBasis` (spec §6.1 (e)): a Kernel session id and a non-negative position or null. */
function sessionBasisProblem(value: unknown): string | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => key === 'sourceKernelSessionId' || key === 'throughPosition')
    || !nonEmpty(value['sourceKernelSessionId'])
    || !(value['throughPosition'] === null
      || (typeof value['throughPosition'] === 'number' && Number.isSafeInteger(value['throughPosition']) && value['throughPosition'] >= 0))) {
    return 'manifest sessionBasis must be {sourceKernelSessionId, throughPosition: null or a safe non-negative integer}';
  }
  return null;
}

function manifestProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'manifest must be an object';
  if (value['schemaVersion'] !== 1) return 'manifest schemaVersion must be 1';
  if (value['kind'] !== 'task_execution') return 'manifest kind must be task_execution';
  const claimProblem = taskClaimProblem(value['claim']);
  if (claimProblem !== null) return claimProblem;
  const roleProblem = roleResolutionProblem(value['role']);
  if (roleProblem !== null) return roleProblem;
  if (value['hostTemplate'] !== null) {
    const hostTemplate = value['hostTemplate'];
    if (!isRecord(hostTemplate) || !nonEmpty(hostTemplate['templateId'])
      || !nonEmpty(hostTemplate['revision']) || !isSha256Hex(hostTemplate['digest'])) {
      return 'manifest hostTemplate must be null or a versioned trusted template';
    }
  }
  if (!isRoleBinding(value['roleBinding'])) return 'manifest roleBinding is not a RoleBindingRefV1';
  if (!nonEmpty(value['hostConfigurationRevision'])) return 'manifest hostConfigurationRevision is required';
  const sessionRoleError = sessionRoleProblem(value['sessionRole']);
  if (sessionRoleError !== null) return sessionRoleError;
  if (!isWorkspacePin(value['workspaceSnapshot'])) return 'manifest workspaceSnapshot is not a complete workspace pin';
  if (!isPermissions(value['permissions'])) return 'manifest permissions are incomplete';
  if (!isBudget(value['budget'])) return 'manifest budget is not a TaskBudgetV1';
  if (!Array.isArray(value['selectedTaskInputs'])) return 'manifest selectedTaskInputs must be an array';
  for (const selection of value['selectedTaskInputs']) {
    if (!isRecord(selection) || !nonEmpty(selection['requirementId']) || !isArtifactRef(selection['ref'])) {
      return 'manifest selectedTaskInputs entries are incomplete';
    }
  }
  const basisProblem = materialBasisProblem(value['materialBasis']);
  if (basisProblem !== null) return basisProblem;
  if (!Array.isArray(value['materialAccessRefs'])) return 'manifest materialAccessRefs must be an array';
  for (const grantRef of value['materialAccessRefs']) {
    const problem = materialGrantRefProblem(grantRef);
    if (problem !== null) return problem;
  }
  if (!Array.isArray(value['additionalMaterialRefs'])) return 'manifest additionalMaterialRefs must be an array';
  for (const artifact of value['additionalMaterialRefs']) {
    if (!isArtifactRef(artifact)) return 'manifest additionalMaterialRefs entries must be complete ArtifactRefs';
  }
  if (!Array.isArray(value['deliveryRefs'])) return 'manifest deliveryRefs must be an array';
  for (const pin of value['deliveryRefs']) {
    const problem = deliveryPinProblem(pin);
    if (problem !== null) return problem;
  }
  if (!Array.isArray(value['sourceRefs'])) return 'manifest sourceRefs must be an array';
  for (const source of value['sourceRefs']) {
    const problem = sourceRefProblem(source);
    if (problem !== null) return problem;
  }
  // C3 / LA-1 optional fields: shape only here; the RUN-02 binding guard compares them.
  if (value['continuationBrief'] !== undefined) {
    const briefProblem = continuationBriefShapeProblem(value['continuationBrief']);
    if (briefProblem !== null) return `manifest ${briefProblem}`;
  }
  if (value['sessionBasis'] !== undefined) {
    const sessionBasisError = sessionBasisProblem(value['sessionBasis']);
    if (sessionBasisError !== null) return sessionBasisError;
  }
  if (typeof value['input'] !== 'string') return 'manifest input must be a string';
  if (!isSha256Hex(value['inputDigest'])) return 'manifest inputDigest must be a sha256 hex';
  return null;
}

export type HostRoleAdmission = { roleFacts: RoleBindingFacts; host: AuthorizeConfigurationResult };

/** The one current Host/Role re-check used by authorize, begin and model traffic. */
export async function recheckHostRoleAdmission(
  deps: Pick<ExecutionEntryDependencies, 'roles' | 'authorizeConfiguration'>,
  ctx: CoreCallContext,
  input: {
    run: RunSnapshot;
    manifestRole: RoleSpecResolutionV1;
    sessionRole: RoleConfigurationRef;
    roleBinding: RoleBindingRefV1;
    permissions: TaskEnvelopeV1['permissions'];
    hostTemplate: PreparedTaskManifestV1['hostTemplate'];
    configurationRevision: string;
  },
): Promise<{ ok: true; value: HostRoleAdmission } | Rejected> {
  const roleFacts = await deps.roles.resolveRoleBindingFacts(ctx, {
    roleBinding: input.roleBinding,
    declaredPermissions: { tools: input.permissions.tools, writeScope: input.permissions.writeScope },
  });
  if (roleFacts.result.status !== 'ready') return { ok: false, rejection: mapReadResult(roleFacts.result) };
  const resolution = roleFacts.result.value;
  if (resolution.status === 'inadmissible') {
    return { ok: false, rejection: forbidden(`the role binding is not admissible: ${resolution.reasons.map(r => r.code).join(',')}`) };
  }
  if (input.manifestRole.status === 'inadmissible') {
    return { ok: false, rejection: forbidden('the prepared manifest carries an inadmissible role resolution') };
  }
  if (input.manifestRole.status !== resolution.status) {
    return { ok: false, rejection: forbidden('the current role resolution changed since the manifest was prepared') };
  }
  if (resolution.status === 'resolved' && input.manifestRole.status === 'resolved') {
    if (resolution.roleId !== input.manifestRole.roleId || !sameRef(resolution.revision, input.manifestRole.revision)) {
      return { ok: false, rejection: forbidden('the current resolved role spec does not match the prepared manifest') };
    }
  }
  if (resolution.status === 'absent') {
    if (input.sessionRole.kind !== 'legacy_template') {
      return { ok: false, rejection: forbidden('a role_spec Session cannot resolve to an absent matrix') };
    }
    if (input.hostTemplate === null) {
      return { ok: false, rejection: reject('unsupported', 'an absent role requires a trusted Host versioned template') };
    }
    if (input.manifestRole.status !== 'absent' || input.manifestRole.roleId !== input.roleBinding.templateId) {
      return { ok: false, rejection: forbidden('the prepared absent role does not match the role binding') };
    }
  }
  const host = await deps.authorizeConfiguration(ctx, {
    run: input.run, roleResolution: resolution, sessionRole: input.sessionRole,
    configurationRevision: input.configurationRevision,
    permissions: input.permissions, hostTemplate: input.hostTemplate,
  });
  if (host.status !== 'ready') return { ok: false, rejection: mapReadResult(host) };
  if (host.value.configurationRevision !== input.configurationRevision
    || !sameRef(host.value.permissions, input.permissions)
    || !sameRef(host.value.hostTemplate, input.hostTemplate)) {
    return { ok: false, rejection: forbidden('the trusted Host configuration disagrees with the prepared manifest') };
  }
  return { ok: true, value: { roleFacts, host: host.value } };
}

function deadlineProblem(run: RunSnapshot, nowIso: string): CoreRejection | null {
  if (run.budget.deadline === null) return null;
  const nowMs = Date.parse(nowIso);
  const deadlineMs = Date.parse(run.budget.deadline);
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs)) return invalid('the deadline is not a legal instant');
  if (!(deadlineMs > nowMs)) return reject('capacity', 'the Run budget deadline has passed');
  return null;
}

type MaterialAdmission = { guards: readonly RecordGuard[] };

/**
 * A selected input is a formal choice ONLY when the accepted `facts.plan`
 * itself names exactly one matching input requirement for this consumer Task
 * and its complete `ArtifactRef` is the manifest's exact selection. A manifest
 * may never self-report a selection the immutable Plan does not carry.
 */
function formalInputRequirement(
  plan: PlanRevisionSnapshot,
  consumerTaskId: string,
  selection: { requirementId: string; ref: ArtifactRef },
): { ok: true; value: TaskInputRequirementV2 } | Rejected {
  const requirements = plan.schemaVersion === 2 ? (plan.inputRequirements ?? []) : [];
  const matches = requirements.filter(requirement =>
    requirement.requirementId === selection.requirementId && requirement.consumerTaskId === consumerTaskId);
  if (matches.length === 0) {
    return { ok: false, rejection: forbidden('the selected material is not an exact input requirement of the accepted Plan for this consumer Task') };
  }
  if (matches.length > 1) {
    return { ok: false, rejection: forbidden('the accepted Plan carries ambiguous input requirements for this selection') };
  }
  const requirement = matches[0]!;
  if (requirement.kind !== 'artifact' || !sameRef(requirement.artifactRef, selection.ref)) {
    return { ok: false, rejection: forbidden('the selected material ref does not match the accepted Plan input requirement') };
  }
  return { ok: true, value: requirement };
}

/**
 * The ONE fresh external-material admission shared by authorizeRuntimeEntry,
 * fresh beginRuntimeEntry and both model-request barriers. It is called at the
 * point where that barrier is about to assemble its ONE `PreparedCommit`, after
 * every other formal fact was re-read, so the exact canonical material versions
 * this decision observed can be merged into that same commit window.
 *
 * The caller already verified identity, Claim, Run/Session/lease, manifest
 * body/digest and Host/Role. This helper only consumes those verified
 * `facts`/`manifest`; it must never re-bind a caller-supplied Run or widen the
 * Host write identity.
 *
 * No external selected/additional material keeps the existing compatible path
 * with empty guards. With external material the helper rebuilds the REAL reader
 * for the formal Run (a `work_run` principal and that Run's `run` material
 * reader/`currentBasis`), checks the accepted Plan selection, reads the exact
 * current body through the reused M2 facts port and returns the exact canonical
 * versions that decision observed. It owns no authorization algorithm and no
 * second material state; `materialFacts` absent stays an explicit
 * `unsupported`, never a bare `openArtifact` that commits without guards.
 */
async function admitExternalMaterials(
  deps: Pick<ExecutionEntryDependencies, 'plans' | 'materialFacts'>,
  ctx: CoreCallContext,
  facts: TaskExecutionRecord,
  manifest: PreparedTaskManifestV1,
): Promise<{ ok: true; value: MaterialAdmission } | Rejected> {
  const selected = manifest.selectedTaskInputs;
  const additional = manifest.additionalMaterialRefs;
  if (selected.length === 0 && additional.length === 0) return { ok: true, value: { guards: [] } };
  const materialFacts = deps.materialFacts;
  if (materialFacts === undefined) {
    return { ok: false, rejection: reject('unsupported',
      'external selected/additional materials require the M2 material-facts grant guard seam; refusing a fresh entry authorization without grant CAS facts') };
  }
  // Narrow once for the closure below; the port is the same instance.
  const factsPort = materialFacts;
  const run = facts.run;
  const claim = facts.outbox.claim;
  const workspaceId = run.workspaceSnapshot.workspaceId;
  // The B2 write context is a trusted Host; a material read must run as the
  // actual claimed Run. This narrows an already-verified execution only, never
  // the Host write identity and never a caller-chosen Run.
  if (run.ref.projectId !== claim.task.projectId || workspaceId !== claim.workspaceId
    || !sameRef(run.ref, claim.runRef)) {
    return { ok: false, rejection: forbidden('the formal Run scope disagrees with the persisted claim') };
  }
  const runCtx: CoreCallContext = {
    projectId: run.ref.projectId,
    workspaceId,
    principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: run.ref,
      ...(manifest.materialBasis === null ? {} : { currentBasis: manifest.materialBasis }) },
    // The original AbortSignal is kept by reference; material admission never
    // creates a second cancellation source.
    signal: ctx.signal,
  };
  const goalRef = goalRefOf(claim.task);
  const guards: RecordGuard[] = [];
  // One exact current read may be reused strictly WITHIN this barrier when a
  // selected and an additional ref coincide; nothing is cached across barriers.
  const exactCurrent = new Map<string, MaterialReadFacts>();

  async function readExactCurrent(ref: ArtifactRef): Promise<{ ok: true; value: ArtifactRecord } | Rejected> {
    const key = refKeyOf(ref);
    if (key === null) return { ok: false, rejection: invalid('the external material ref is not canonicalizable JSON') };
    let observed: MaterialReadFacts | undefined = exactCurrent.get(key);
    if (observed === undefined) {
      observed = await factsPort.openArtifactFacts(runCtx, { ref, usage: 'current' });
      exactCurrent.set(key, observed);
    }
    if (observed.result.status !== 'ready') return { ok: false, rejection: mapReadResult(observed.result) };
    if (!sameRef(observed.result.value.ref, ref)) {
      return { ok: false, rejection: unavailable('the current material read returned a different exact ref than requested') };
    }
    guards.push(...observed.guards);
    return { ok: true, value: observed.result.value };
  }

  const selectedIds = new Set<string>();
  for (const selection of selected) {
    if (selectedIds.has(selection.requirementId)) {
      return { ok: false, rejection: forbidden('the manifest repeats one selected input requirement') };
    }
    selectedIds.add(selection.requirementId);
    const formal = formalInputRequirement(facts.plan, claim.task.taskId, selection);
    if (!formal.ok) return formal;
    const formalRead = await deps.plans.readTaskInput(runCtx, {
      goalRef, planRef: facts.plan.ref, taskId: claim.task.taskId, requirementId: formal.value.requirementId });
    if (formalRead.status !== 'ready') return { ok: false, rejection: mapReadResult(formalRead) };
    if (!sameRef(formalRead.value.ref, selection.ref)) {
      return { ok: false, rejection: forbidden('the accepted Plan input read returned a different exact ref than the manifest selection') };
    }
    const current = await readExactCurrent(selection.ref);
    if (!current.ok) return current;
    // Two independent reads of one immutable digest must agree on the body; the
    // later read never silently replaces the material the Plan selected.
    if (current.value.body !== formalRead.value.body) {
      return { ok: false, rejection: unavailable('the accepted Plan selection and the current material read disagree on the body of the same exact ref') };
    }
  }
  for (const ref of additional) {
    const current = await readExactCurrent(ref);
    if (!current.ok) return current;
  }
  return { ok: true, value: { guards } };
}

export type EnteredAdmission = {
  facts: TaskExecutionRecord;
  auth: ExecutionAuthorizationV2;
  manifest: PreparedTaskManifestV1;
  inputBinding: RuntimeInputBindingV1;
  roleFacts: RoleBindingFacts;
  /** Exact fresh material-facts guards read by this admission; merged into the
   * model barrier's ONE commit, never cached across barriers. */
  materialGuards: readonly RecordGuard[];
};

/**
 * Shared narrow admission for the model lane: the permit must match the CURRENT
 * V2 entered binding, the Run must be running, the saved manifest must still be
 * authorized by the current Host/Role facts and the exact input binding must
 * still be the Run's own.
 */
export async function admitEnteredRun(
  deps: Omit<ExecutionEntryDependencies, 'newId'>,
  ctx: CoreCallContext,
  permit: TaskEntryPermit,
  expectedPin: VersionPin,
): Promise<{ ok: true; value: EnteredAdmission } | Rejected> {
  const factsRead = await readAdmissionFacts(deps, ctx, permit.claim.runRef, expectedPin);
  if (!factsRead.ok) return factsRead;
  const enteredControl = runControlFence(factsRead.value.run);
  if (enteredControl !== null) return { ok: false, rejection: enteredControl };
  const { run, outbox, session } = factsRead.value;
  // RUN-04/05's guards at the barrier's own points: the V2 binding; after the phase
  // and status, the persisted claim, the permit, then the claim Session and Lease.
  const v2 = entryV2Binding(run);
  if (!v2.ok) return { ok: false, rejection: runRefusal(v2) };
  const auth = v2.next;
  if (auth.phase !== 'entered') return { ok: false, rejection: busy('the Run entry is not entered') };
  if (run.status !== 'running') return { ok: false, rejection: busy('the Run is not running') };
  const permitRefused = refusalOf(permitClaimGuard(outbox.claim, permit) ?? entryPermitGuard(auth, permit));
  if (permitRefused !== null) return { ok: false, rejection: permitRefused };
  if (outbox.claim.sessionRef.projectId !== session.ref.projectId
    || outbox.claim.sessionRef.sessionId !== session.ref.sessionId) {
    return { ok: false, rejection: unavailable('the claim Session mapping changed') };
  }
  const held = refusalOf(claimHoldGuard(claimSessionOf(session, permit.claim), claimLeaseOf(factsRead.value.lease, permit.claim)));
  if (held !== null) return { ok: false, rejection: held };
  const inputBinding = run.inputBinding;
  if (inputBinding === undefined) return { ok: false, rejection: forbidden('the Run has no persisted input binding') };
  const bindingProblem = inputBindingProblem(inputBinding);
  if (bindingProblem !== null) return { ok: false, rejection: unavailable(`the Run input binding is damaged: ${bindingProblem}`) };
  const stored = await readStoredManifest(deps, run);
  if (!stored.ok) return stored;
  const manifest = stored.value.manifest;
  if (manifest.inputDigest !== inputBinding.inputDigest || manifest.inputDigest !== permit.inputDigest) {
    return { ok: false, rejection: forbidden('the entry permit input digest disagrees with the saved manifest') };
  }
  const admitted = await admitManifest(deps, ctx, factsRead.value, manifest);
  if (!admitted.ok) return admitted;
  return { ok: true, value: { facts: factsRead.value, auth, manifest, inputBinding, ...admitted.value } };
}

type ManifestAdmission = Pick<EnteredAdmission, 'roleFacts' | 'materialGuards'>;
type Admitted = { ok: true; value: ManifestAdmission } | Rejected;

/**
 * The fresh re-admission of a saved manifest that authorize, begin and the
 * model barrier share, in today's order: the current Host/Role, the deadline,
 * then the external materials.
 */
async function admitManifest(
  deps: Omit<ExecutionEntryDependencies, 'newId'>, ctx: CoreCallContext, facts: TaskExecutionRecord,
  manifest: PreparedTaskManifestV1,
): Promise<Admitted> {
  const hostRole = await recheckHostRoleAdmission(deps, ctx, {
    run: facts.run, manifestRole: manifest.role, sessionRole: facts.session.role,
    roleBinding: facts.run.roleBinding, permissions: manifest.permissions,
    hostTemplate: manifest.hostTemplate, configurationRevision: manifest.hostConfigurationRevision,
  });
  if (!hostRole.ok) return hostRole;
  const deadline = deadlineProblem(facts.run, deps.now());
  if (deadline !== null) return { ok: false, rejection: deadline };
  const material = await admitExternalMaterials(deps, ctx, facts, manifest);
  if (!material.ok) return material;
  return { ok: true, value: { roleFacts: hostRole.value.roleFacts, materialGuards: material.value.guards } };
}

// --------------------------------------------------------------------------
// Run machine facts (STATE-MACHINES-SPEC §6.1, §5, §8)
// --------------------------------------------------------------------------

/**
 * The claim Lease as the Run machine's Lease guard reads it: missing, released
 * (§5 `taskLeaseNodeOf`), naming another Task than `claim`, held by this claim
 * (`leaseOwnedByRun`, the release rule of RUN-07), or held by another one. The
 * execution read keys the Lease by the Run's Task (`run-state-service.ts:309`),
 * so another Task is reachable only through W3's prepared claim, which RUN-02
 * asks about the Lease before the persisted claim; W4..W6 compare the persisted
 * claim first.
 */
export function claimLeaseOf(lease: TaskLeaseSnapshot | null, claim: TaskClaim): RunGuardContext['lease'] {
  if (lease === null) return 'missing';
  if (taskLeaseNodeOf(lease) === 'released') return 'released';
  if (lease.ref.projectId !== claim.task.projectId || lease.ref.goalId !== claim.task.goalId
    || lease.ref.taskId !== claim.task.taskId) {
    return 'other_task';
  }
  return leaseOwnedByRun(lease, claim) ? 'owned' : 'other';
}

/** The claim Session as this Run holds it (§8 `ownsOccupancy`) and its Kernel mapping. */
export function claimSessionOf(session: SessionRecord, claim: TaskClaim): RunGuardContext['session'] {
  return {
    usable: session.lifecycle === 'active' && session.health === 'available',
    owned: ownsOccupancy(session, claim.runRef, claim.generation),
    kernel: { adapterId: session.kernel.adapterId, kernelSessionId: session.kernel.kernelSessionId },
    archived: session.lifecycle !== 'active',
  };
}

/**
 * RUN-02/04/05/07's guard context from one execution read: the claim Session
 * as this Run holds it, the claim Lease and the persisted claim. The Goal, the
 * Plan pin and the fresh admission are authorize/begin's later reads and hold
 * until read; control, reconcile and claim facts belong to other Run events.
 */
function entryRunContext(facts: TaskExecutionRecord, claim: TaskClaim, actor: HostActor): RunGuardContext {
  return {
    session: claimSessionOf(facts.session, claim),
    lease: claimLeaseOf(facts.lease, claim),
    persistedClaim: facts.outbox.claim,
    goal: { desiredState: 'active', activePlanMatchesClaim: true },
    entryPlan: 'active_plan',
    continuationBrief: 'absent_ok',
    freshAdmission: null,
    pointerIntent: null,
    queuedSteers: [],
    continuationConsumed: false,
    exitProof: null,
    hostLease: null,
    kernelProbe: null,
    kernelPaused: false,
    inputsConfirmed: null,
    actor: isAutomationActor(actor) ? 'system' : 'human',
    claim: null,
  };
}

/**
 * A Run machine refusal as the rejection today's service returned (§1.2: code
 * and reason kept). RUN-02/04's last guard refuses with the fresh admission's
 * own rejection, which is returned as is so its `current` pins survive.
 */
function runRefusal(refused: Extract<RunTransition, { ok: false }>, admission: CoreRejection | null = null): CoreRejection {
  if (admission !== null && refused.code === admission.code && refused.detail === admission.reason) return admission;
  return reject(refused.code, refused.detail);
}

/** A Run machine guard the model barrier asks outside a transition, mapped as `runRefusal` maps it. */
function refusalOf(refused: MachineRefusal | null): CoreRejection | null {
  return refused === null || refused.ok ? null : runRefusal(refused);
}

/** The Run an accepted transition writes: `next.record` is the whole next Run (§6). */
function nextRunOf(next: RunState): RunSnapshot {
  if (next.record === null) throw new Error('an accepted Run transition names the Run it writes');
  return next.record;
}

/** The §5 event of the same Run event (`attemptEventFromRunEvent`); every event mapped here writes the Attempt. */
function attemptEventOf(event: RunEventForAttempt): AttemptEvent {
  const mapped = attemptEventFromRunEvent(event);
  if (mapped === null) throw new Error(`${event.kind} writes no TaskAttempt`);
  return mapped;
}

const KERNEL_SLOT_PREFIX = 'execution-history-kernel:';

/** RUN-04's `claim_kernel_slot` as the shared Kernel identity unique-slot change (`none`: no owner yet). */
function kernelSlotChange(effect: RunEffect, runKey: string): UniqueClaimChange {
  if (effect.kind !== 'claim_kernel_slot') throw new Error(`entry_begun has no ${effect.kind} effect`);
  const kernel = effect.kernel;
  return {
    claimKey: KERNEL_SLOT_PREFIX + canonicalJson({ adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId,
      runId: kernel.runId, turnId: kernel.turnId } as unknown as JsonValue),
    expectedOwner: effect.expectedOwner === 'none' ? null : runKey,
    nextOwner: runKey,
  };
}

/**
 * SES-04's guard context for RUN-07's `release_session`: the holder is the Run
 * it ends, at its claim generation, with the complete Turn boundary its Kernel
 * terminal carries (inputs confirmed by the Runtime before it books a terminal).
 */
function terminalReleaseContext(release: SessionRelease): SessionGuardContext {
  return {
    caller: 'service', hostLease: null, pin: null,
    holder: {
      ref: release.holder, claimGeneration: release.generation, before: 'run_running', after: 'run_ended',
      kernelTurnSeen: true, inputsConfirmed: true,
      historyBoundaryCursor: release.historyCursor.kind === 'advance' ? release.historyCursor.cursor : null,
      kernelTurnOpen: release.kernelTurnOpen,
    },
    probe: null, kernelHeader: null, openResponsibleLink: null, creation: null, link: null,
  };
}

/** The node RUN-05/07 moves from: the paired Run of their §5 event (D-14). */
const PAIRED_RUN_NODE = { entered_observed: 'Entering', terminal_observed: 'Running' } as const;

/** RUN-05/07's §5 pairing: the Run node it moves from, and what the Run still holds. */
function pairingOf(kind: keyof typeof PAIRED_RUN_NODE, facts: TaskExecutionRecord, runCtx: RunGuardContext): AttemptGuardContext {
  return { runNode: PAIRED_RUN_NODE[kind], runLastEventSeq: facts.run.lastEventSeq,
    ownsSession: runCtx.session.owned, ownsLease: runCtx.lease === 'owned' };
}

/**
 * The Session release a Run event's `release_session` effect carries through
 * §8 `occupancy_released`: the cause selects the SES row and `context` builds
 * its holder guard context; `null` for an event that releases no Session.
 */
export type ClaimSessionRelease = { cause: SessionReleaseCause; context(release: SessionRelease): SessionGuardContext } | null;

/**
 * A Run event's effects on the other records of its claim in the same commit,
 * each written by its own machine with the §5 event of the same Run event: the
 * Attempt (ATT-02/05/06), the Outbox (ATT-26/27/30), and only what the Run
 * still holds, its Lease (ATT-18/23) and its Session occupancy (SES-04: the
 * cursor moves to the complete Turn boundary; SES-05: it is kept). `effects`
 * are the claim's only (`attempt`, `outbox`, `release_lease`,
 * `release_session`). Records in today's order: Attempt, Outbox, Lease,
 * Session.
 */
export function claimEffectRecords(
  effects: readonly RunEffect[], facts: TaskExecutionRecord, pairing: AttemptGuardContext, attemptEvent: AttemptEvent,
  release: ClaimSessionRelease,
): { ok: true; records: EncodedRecord[] } | Rejected {
  let attempt: TaskAttemptSnapshot | null = null;
  let outbox: DispatchOutboxRecord | null = null;
  let lease: TaskLeaseSnapshot | null = null;
  let session: SessionRecord | null = null;
  for (const effect of effects) {
    switch (effect.kind) {
      case 'attempt': {
        const next = transitionAttempt(facts.attempt, attemptEvent, pairing);
        if (!next.ok) return { ok: false, rejection: reject(next.code, next.detail) };
        attempt = next.next;
        break;
      }
      case 'outbox': {
        const next = transitionDispatchOutbox(facts.outbox, attemptEvent, pairing);
        if (!next.ok) return { ok: false, rejection: reject(next.code, next.detail) };
        outbox = next.next;
        break;
      }
      case 'release_lease': {
        if (!isTaskLeaseEvent(attemptEvent)) throw new Error(`${attemptEvent.kind} drives the TaskLease`);
        const next = transitionTaskLease(facts.lease, attemptEvent);
        if (!next.ok) return { ok: false, rejection: reject(next.code, next.detail) };
        lease = next.next;
        break;
      }
      case 'release_session': {
        if (release === null) throw new Error(`${attemptEvent.kind} releases no Session`);
        const next = transitionSession(sessionMachineStateOf(facts.session),
          { kind: 'occupancy_released', cause: release.cause }, release.context(effect));
        if (!next.ok) return { ok: false, rejection: reject(next.code, next.detail) };
        for (const sessionEffect of next.effects) {
          if (sessionEffect.kind !== 'release_session') throw new Error(`occupancy_released has no ${sessionEffect.kind} effect`);
          session = releaseSessionRecord(facts.session, sessionEffect);
        }
        break;
      }
      default:
        throw new Error(`${attemptEvent.kind} has no ${effect.kind} effect on its claim records`);
    }
  }
  if (attempt === null || outbox === null) throw new Error(`${attemptEvent.kind} must write the Attempt and the Outbox`);
  return { ok: true, records: [encodeTaskAttemptSnapshot(attempt), encodeDispatchOutboxEntry(outbox),
    ...(lease === null ? [] : [encodeLease(lease)]), ...(session === null ? [] : [encodeSessionRecord(session)])] };
}

/**
 * The exact versions of the execution read every entry commit keeps: the Run
 * at the caller's pin, its Attempt, Outbox, Plan and claim Session, and the
 * Lease whenever one was read (it decides the release, so it is pinned whether
 * or not this Run still holds it; RUN-02/04/05 refuse a missing one).
 */
function executionReadGuards(facts: TaskExecutionRecord, runKey: string, runPin: VersionPin): RecordGuard[] {
  return [
    { refKey: runKey, expectedRevision: runPin.revision },
    { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
    { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
    { refKey: planRevisionRefKey(facts.plan.ref), expectedRevision: facts.plan.revision },
    { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(facts.outbox.claim.sessionRef)), expectedRevision: facts.session.revision },
    ...(facts.lease === null ? [] : [{ refKey: refKeyOf(facts.lease.ref) as string, expectedRevision: facts.lease.revision }]),
  ];
}

/** A fresh entry admission as RUN-02/04 read it: its refusal, or the guards it read (role facts, then materials). */
function freshAdmissionOf(admitted: Admitted): { problem: CoreRejection | null; guards: readonly RecordGuard[] } {
  return admitted.ok ? { problem: null, guards: [...admitted.value.roleFacts.guards, ...admitted.value.materialGuards] }
    : { problem: admitted.rejection, guards: [] };
}

/**
 * RUN-02's `freshAdmission`, in today's order and with its own IO: the Goal
 * workspace, the saved manifest against the prepared input, the current
 * Host/Role, the deadline and the external materials.
 */
async function authorizeAdmission(
  deps: ExecutionEntryDependencies, ctx: CoreCallContext, scope: WorkspaceScope,
  prepared: PreparedTaskExecution, facts: TaskExecutionRecord, goalWorkspaceId: string,
): Promise<Admitted> {
  const claim = prepared.claim;
  if (goalWorkspaceId !== claim.workspaceId) return { ok: false, rejection: forbidden('the Goal belongs to another workspace') };
  const stored = await readManifestFromEnvelope(deps, prepared.envelope as unknown as Record<string, unknown>, claim.runRef);
  if (!stored.ok) return stored;
  const manifest = stored.value.manifest;
  const manifestRejection = manifestAgainstPrepared(manifest, prepared, facts, stored.value.bodyDigest, scope);
  if (manifestRejection !== null) return { ok: false, rejection: manifestRejection };
  return admitManifest(deps, ctx, facts, manifest);
}

/** RUN-04's `freshAdmission`: the saved manifest of the Run, then as RUN-02 from the Host/Role on. */
async function beginAdmission(
  deps: ExecutionEntryDependencies, ctx: CoreCallContext, facts: TaskExecutionRecord,
): Promise<Admitted> {
  const stored = await readStoredManifest(deps, facts.run);
  if (!stored.ok) return stored;
  return admitManifest(deps, ctx, facts, stored.value.manifest);
}

// --------------------------------------------------------------------------
// Replay restore
// --------------------------------------------------------------------------

export async function loadReplayEvent(
  records: GoalRecordTransactionPort,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
): Promise<{ ok: true; event: EncodedDomainEvent } | Rejected> {
  if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
    return { ok: false, rejection: unavailable('the receipt does not name exactly one event') };
  }
  const at = await records.eventAt(receipt.cursor);
  if (at.status !== 'ready') return { ok: false, rejection: mapStoreFailure(at) };
  if (!sameCursor(at.value.cursor, receipt.cursor)) {
    return { ok: false, rejection: unavailable('the returned event cursor disagrees with the receipt') };
  }
  if (at.value.event.eventId !== receipt.eventIds[0]) {
    return { ok: false, rejection: unavailable('the recorded event id disagrees with the receipt') };
  }
  return { ok: true, event: at.value.event };
}

// --------------------------------------------------------------------------
// Identity / fingerprint
// --------------------------------------------------------------------------

function identityKey(prefix: string, actor: HostActor, scope: WorkspaceScope, requestId: string): string {
  return prefix + sha256Hex(canonicalJson({
    actor: { kind: actor.kind, id: actor.id },
    projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
  } as unknown as JsonValue));
}
function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value as JsonValue));
}
function expectedPinList(pin: VersionPin): Array<{ ref: VersionPin['ref']; revision: number }> {
  return [{ ref: pin.ref, revision: pin.revision }];
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

/** The ONE accepted prepared-manifest body content type (declared once in contracts, ND-9). */
export { MANIFEST_CONTENT_TYPE };

const ENTRY_AUTHORIZE_PREFIX = 'b2-entry-authorize:';
const ENTRY_BEGIN_PREFIX = 'b2-entry-begin:';
const ENTRY_ENTERED_PREFIX = 'b2-entry-entered:';
const ENTRY_RESULT_PREFIX = 'b2-entry-result:';

export function createExecutionEntryService(deps: ExecutionEntryDependencies): ExecutionEntryPort {
  const records = deps.records;

  // ---- authorize ---------------------------------------------------------
  async function authorizeRuntimeEntry(
    ctx: CoreCallContext,
    request: GraphWrite<{ prepared: PreparedTaskExecution; consumerId: string }>,
  ): Promise<WriteResult<TaskEntryPermit>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const { prepared, consumerId } = owned.input;
    if (!isRecord(prepared) || prepared.kind !== 'task' || !isRecord(prepared.claim)
      || !isRecord(prepared.envelope) || !isRecord(prepared.inputBinding)) {
      return invalid('authorizeRuntimeEntry requires a prepared task execution');
    }
    if (!nonEmpty(consumerId)) return invalid('authorizeRuntimeEntry requires a consumerId');
    const claimProblem = taskClaimProblem(prepared.claim);
    if (claimProblem !== null) return invalid(`the prepared claim is malformed: ${claimProblem}`);
    const claim = prepared.claim;
    const envelopeProblem = preparedEnvelopeProblem(prepared.envelope as unknown as Record<string, unknown>, claim);
    if (envelopeProblem !== null) return envelopeProblem;
    const bindingProblem = inputBindingProblem(prepared.inputBinding);
    if (bindingProblem !== null) return invalid(`the prepared inputBinding is malformed: ${bindingProblem}`);
    if (claim.task.projectId !== scope.projectId || claim.workspaceId !== scope.workspaceId) {
      return forbidden('the prepared claim is outside the trusted Host scope');
    }
    const checkedRun = checkRunPin(owned.expected, claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return reject('cancelled', 'the authorization was cancelled before lookup');

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(ENTRY_AUTHORIZE_PREFIX, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({
        kind: 'b2-entry-authorize', actor: { kind: actor.kind, id: actor.id },
        consumerId, claim, envelope: prepared.envelope, inputBinding: prepared.inputBinding,
        expected: expectedPinList(runPin),
      });
    } catch {
      return invalid('the authorization request is not canonicalizable JSON');
    }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') {
        return await replayAuthorize(lookup.value, identity, fingerprint, actor, claim, consumerId);
      }
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return reject('cancelled', 'the authorization was cancelled during lookup');

      const factsRead = await readAdmissionFacts(deps, scopeCtx, claim.runRef, runPin);
      if (!factsRead.ok) return factsRead.rejection;
      // RUN-02's first guard, the control pointer fence, comes before the cancellation check.
      const authorizeControl = runControlFence(factsRead.value.run);
      if (authorizeControl !== null) return authorizeControl;
      if (signal.aborted) return reject('cancelled', 'the authorization was cancelled during the execution read');
      const facts = factsRead.value;
      // RUN-02 on the execution read: starting, the claim Session and Lease, the
      // persisted claim, the prepared binding and no existing authorization. The
      // Goal and the fresh admission are read below and hold until then.
      const state = runStateOf(facts.run);
      const runEvent: RunEvent = { kind: 'entry_authorized', claim, consumerId,
        envelope: prepared.envelope, inputBinding: prepared.inputBinding };
      let runCtx = entryRunContext(facts, claim, actor);
      const onExecution = transitionRun(state, runEvent, runCtx);
      if (!onExecution.ok) return runRefusal(onExecution);

      // Current Goal/Workspace scope facts and their exact guards: the Goal is active and pins the claim's Plan.
      const goalScope = await readGoalScope(records, goalRefOf(claim.task));
      if (goalScope.status !== 'ready') return mapReaderRejection(goalScope);
      const activePlan = goalScope.goal.activePlanRevision;
      const onActivePlan = activePlan !== null && sameRef(activePlan, claim.planRef);
      runCtx = { ...runCtx, goal: { desiredState: goalScope.goal.desiredState, activePlanMatchesClaim: onActivePlan },
        entryPlan: onActivePlan ? 'active_plan' : 'changed' };
      const onGoal = transitionRun(state, runEvent, runCtx);
      if (!onGoal.ok) return runRefusal(onGoal);

      const admission = freshAdmissionOf(
        await authorizeAdmission(deps, scopeCtx, scope, prepared, facts, goalScope.goal.workspaceRef.workspaceId));
      const authorized = transitionRun(state, runEvent, { ...runCtx, freshAdmission: admission.problem });
      if (!authorized.ok) return runRefusal(authorized, admission.problem);
      const nextRun = nextRunOf(authorized.next);
      const authorization = nextRun.executionAuthorization as ExecutionAuthorizationV2;
      const permit: TaskEntryPermit = {
        claim, consumerId, entryGeneration: authorization.generation, authorizationRevision: authorization.revision,
        inputDigest: authorization.inputDigest,
      };
      const runRecord = encodeRun(nextRun);
      const event = {
        eventId: deps.eventId(), eventType: EXECUTION_ENTRY_AUTHORIZED_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: deps.now(),
        identityKey: identity, actor, fingerprint, permit,
      };
      if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return reject('unsupported', 'the injected id/clock source produced an empty value');
      const goalKey = refKeyOf(goalRefOf(claim.task));
      if (goalKey === null) return invalid('the Goal ref is not canonicalizable JSON');
      const merged = mergeGuards([
        ...executionReadGuards(facts, runRecord.refKey, runPin),
        { refKey: goalKey, expectedRevision: goalScope.goal.revision },
        { refKey: goalScope.workspaceKey, expectedRevision: goalScope.workspaceRevision },
        ...admission.guards,
      ]);
      if (!merged.ok) return merged.rejection;
      const guards = merged.guards;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards, records: [runRecord], claims: [],
        indexGuards: [], indexChanges: [], events: [encodeExecutionEntryAuthorizedEvent(event)],
      };
      if (signal.aborted) return reject('cancelled', 'the authorization was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayAuthorize(receipt, identity, fingerprint, actor, claim, consumerId);
      return { status: 'committed', value: permit, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return unavailable(`the authorization write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function replayAuthorize(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string, fingerprint: string, actor: HostActor, claim: TaskClaim, consumerId: string,
  ): Promise<WriteResult<TaskEntryPermit>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = executionEntryAuthorizedEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded entry-authorized event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded authorization disagrees with the request identity');
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded authorization belongs to another actor');
    if (!sameRef(event.permit.claim, claim) || event.permit.consumerId !== consumerId) {
      return unavailable('the recorded authorization disagrees with the request content');
    }
    return { status: 'committed', value: event.permit, replayed: true, cursor: receipt.cursor };
  }

  // ---- begin -------------------------------------------------------------
  async function beginRuntimeEntry(
    ctx: CoreCallContext,
    request: GraphWrite<{ permit: TaskEntryPermit; kernel: KernelExecutionBinding }>,
  ): Promise<WriteResult<RuntimeEntryRecord>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const { permit, kernel } = owned.input;
    const permitProblem = taskEntryPermitProblem(permit);
    if (permitProblem !== null) return invalid(permitProblem);
    if (!isKernelBinding(kernel)) return invalid('beginRuntimeEntry requires a complete Kernel identity');
    const checkedRun = checkRunPin(owned.expected, permit.claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return reject('cancelled', 'the begin was cancelled before lookup');

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(ENTRY_BEGIN_PREFIX, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-entry-begin', actor: { kind: actor.kind, id: actor.id },
        permit, kernel, expected: expectedPinList(runPin) });
    } catch { return invalid('the begin request is not canonicalizable JSON'); }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayBegin(lookup.value, identity, fingerprint, actor, permit, kernel);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return reject('cancelled', 'the begin was cancelled during lookup');

      const factsRead = await readAdmissionFacts(deps, scopeCtx, permit.claim.runRef, runPin);
      if (!factsRead.ok) return factsRead.rejection;
      // RUN-04's first guard, the control pointer fence, comes before the cancellation check.
      const beginControl = runControlFence(factsRead.value.run);
      if (beginControl !== null) return beginControl;
      if (signal.aborted) return reject('cancelled', 'the begin was cancelled during the execution read');
      const facts = factsRead.value;
      // RUN-04 on the execution read: starting, the persisted claim, the V2
      // binding in `authorized` and the permit, the claim Session and Lease, the
      // input binding. The fresh admission is read below and holds until then.
      const state = runStateOf(facts.run);
      const runEvent: RunEvent = { kind: 'entry_begun', permit, kernel };
      const runCtx = entryRunContext(facts, permit.claim, actor);
      const onExecution = transitionRun(state, runEvent, runCtx);
      if (!onExecution.ok) return runRefusal(onExecution);

      const admission = freshAdmissionOf(await beginAdmission(deps, scopeCtx, facts));
      const begun = transitionRun(state, runEvent, { ...runCtx, freshAdmission: admission.problem });
      if (!begun.ok) return runRefusal(begun, admission.problem);
      const nextRun = nextRunOf(begun.next);
      const nextAuthorization = nextRun.executionAuthorization as ExecutionAuthorizationV2;
      const runRecord = encodeRun(nextRun);
      const entry: RuntimeEntryRecord = { runRef: facts.run.ref, runRevision: nextRun.revision, authorization: nextAuthorization };
      const event = {
        eventId: deps.eventId(), eventType: EXECUTION_ENTRY_BEGUN_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: deps.now(),
        identityKey: identity, actor, fingerprint, permit, kernel, entry,
      };
      if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return reject('unsupported', 'the injected id/clock source produced an empty value');
      const runKey = runRecord.refKey;
      // RUN-04's one effect: the shared Kernel identity slot, claimed by this Run in the same commit.
      const claims = begun.effects.map(effect => kernelSlotChange(effect, runKey));
      const merged = mergeGuards([...executionReadGuards(facts, runKey, runPin), ...admission.guards]);
      if (!merged.ok) return merged.rejection;
      const guards = merged.guards;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards, records: [runRecord], claims,
        indexGuards: [], indexChanges: [], events: [encodeExecutionEntryBegunEvent(event)],
      };
      if (signal.aborted) return reject('cancelled', 'the begin was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayBegin(receipt, identity, fingerprint, actor, permit, kernel);
      return { status: 'committed', value: entry, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return unavailable(`the begin write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function replayBegin(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string, fingerprint: string, actor: HostActor, permit: TaskEntryPermit, kernel: KernelExecutionBinding,
  ): Promise<WriteResult<RuntimeEntryRecord>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = executionEntryBegunEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded entry-begun event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded begin disagrees with the request identity');
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded begin belongs to another actor');
    if (!sameRef(event.permit, permit) || !sameKernel(event.kernel, kernel)) {
      return unavailable('the recorded begin disagrees with the request content');
    }
    return { status: 'committed', value: event.entry, replayed: true, cursor: receipt.cursor };
  }

  // ---- entered -----------------------------------------------------------
  async function recordExecutionEntered(
    ctx: CoreCallContext,
    request: GraphWrite<{
      permit: TaskEntryPermit; enteredAt: string;
      kernelSource: KernelObservationSource; history: ObservedExecutionHistory;
    }>,
  ): Promise<WriteResult<RunSnapshot>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const { permit, enteredAt, kernelSource, history } = owned.input;
    const permitProblem = taskEntryPermitProblem(permit);
    if (permitProblem !== null) return invalid(permitProblem);
    if (!isKernelObservationSource(kernelSource)) return invalid('recordExecutionEntered requires a Kernel source with a positive position');
    if (!observedHistoryProblem(history)) return invalid('recordExecutionEntered requires a complete observed history');
    if (!nonEmpty(enteredAt) || !Number.isFinite(Date.parse(enteredAt))) return invalid('enteredAt must be a legal instant');
    const checkedRun = checkRunPin(owned.expected, permit.claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return reject('cancelled', 'the entered write was cancelled before lookup');

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(ENTRY_ENTERED_PREFIX, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-entry-entered', actor: { kind: actor.kind, id: actor.id },
        permit, kernelSource, history, expected: expectedPinList(runPin) });
    } catch { return invalid('the entered request is not canonicalizable JSON'); }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayEntered(lookup.value, identity, fingerprint, actor, permit);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return reject('cancelled', 'the entered write was cancelled during lookup');

      const factsRead = await readAdmissionFacts(deps, scopeCtx, permit.claim.runRef, runPin);
      if (!factsRead.ok) return factsRead.rejection;
      if (signal.aborted) return reject('cancelled', 'the entered write was cancelled during the execution read');
      const facts = factsRead.value;
      // RUN-05: the persisted claim, the V2 binding in `entering` and the
      // permit, the claim Session and Lease, the begin's Kernel identity, the
      // position and the history locator. The entered fact is already-occurred
      // evidence: it must not re-apply the pointer fence or the fresh
      // Host/Role/material admission gates here. authorize/begin and the model
      // barriers keep those; this write keeps only the original permit, claim,
      // Run/Kernel/Session/Lease identity and the real history source.
      const runCtx = entryRunContext(facts, permit.claim, actor);
      const entered = transitionRun(runStateOf(facts.run),
        { kind: 'entered_observed', permit, kernelSource, history, enteredAt }, runCtx);
      if (!entered.ok) return runRefusal(entered);
      const nextRun = nextRunOf(entered.next);
      const runRecord = encodeRun(nextRun);
      const eventId = deps.eventId();
      if (!nonEmpty(eventId)) return reject('unsupported', 'the injected id source produced an empty event id');
      // RUN-05's effects in this commit: the Attempt starts (ATT-02) and the Outbox enters (ATT-26).
      const written = claimEffectRecords(entered.effects, facts, pairingOf('entered_observed', facts, runCtx),
        attemptEventOf({ kind: 'entered_observed', enteredAt, consumerId: permit.consumerId,
          entryGeneration: permit.entryGeneration, sessionGeneration: permit.claim.generation, eventId }), null);
      if (!written.ok) return written.rejection;
      const event = {
        eventId, eventType: EXECUTION_ENTRY_ENTERED_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: deps.now(),
        identityKey: identity, actor, fingerprint, permit, run: nextRun,
      };
      const merged = mergeGuards(executionReadGuards(facts, runRecord.refKey, runPin));
      if (!merged.ok) return merged.rejection;
      const guards = merged.guards;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards, records: [runRecord, ...written.records], claims: [],
        indexGuards: [], indexChanges: [], events: [encodeExecutionEntryEnteredEvent(event)],
      };
      if (signal.aborted) return reject('cancelled', 'the entered write was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayEntered(receipt, identity, fingerprint, actor, permit);
      return { status: 'committed', value: nextRun, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return unavailable(`the entered write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function replayEntered(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string, fingerprint: string, actor: HostActor, permit: TaskEntryPermit,
  ): Promise<WriteResult<RunSnapshot>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = executionEntryEnteredEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded entered event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded entered fact disagrees with the request identity');
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded entered fact belongs to another actor');
    if (!sameRef(event.permit, permit)) return unavailable('the recorded entered fact disagrees with the request permit');
    return { status: 'committed', value: event.run, replayed: true, cursor: receipt.cursor };
  }

  // ---- result ------------------------------------------------------------
  async function recordRunResult(
    ctx: CoreCallContext,
    request: GraphWrite<TaskResultObservation>,
  ): Promise<WriteResult<RunSnapshot>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const observation = owned.input;
    if (!isRecord(observation) || !isRecord(observation.claim) || !isRecord(observation.entry) || !isRecord(observation.event)) {
      return invalid('recordRunResult requires a complete task result observation');
    }
    const claimProblem = taskClaimProblem(observation.claim);
    if (claimProblem !== null) return invalid(`the result claim is malformed: ${claimProblem}`);
    const claim = observation.claim;
    if (!nonEmpty(observation.entry.consumerId) || !isPositiveSafeInteger(observation.entry.entryGeneration)) {
      return invalid('the result entry projection is incomplete');
    }
    // RUN-07 accepts only the V2 binding's own consumer and generation, so this is also what the commit records.
    const entry = { consumerId: observation.entry.consumerId, entryGeneration: observation.entry.entryGeneration };
    const checkedRun = checkRunPin(owned.expected, claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return reject('cancelled', 'the result write was cancelled before lookup');

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(ENTRY_RESULT_PREFIX, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-entry-result', actor: { kind: actor.kind, id: actor.id },
        claim, entry, event: observation.event, kernelSource: observation.kernelSource,
        completedHistoryBoundary: observation.completedHistoryBoundary, history: observation.history,
        continuation: observation.continuation ?? null,
        expected: expectedPinList(runPin) });
    } catch { return invalid('the result request is not canonicalizable JSON'); }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayResult(lookup.value, identity, fingerprint, actor, claim, observation);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return reject('cancelled', 'the result write was cancelled during lookup');

      const factsRead = await readAdmissionFacts(deps, scopeCtx, claim.runRef, runPin);
      if (!factsRead.ok) return factsRead.rejection;
      if (signal.aborted) return reject('cancelled', 'the result write was cancelled during the execution read');
      const facts = factsRead.value;
      // RUN-07: the persisted claim, the V2 binding in `entered` on a Run not
      // ended yet, the entry projection, the complete Turn boundary, the event
      // and the yield binding, then the history locator. Terminal reduction
      // records an already-entered fact: it does NOT re-apply the new-action
      // Host/Role/material admission gates. The caller is the in-process Runtime
      // after its clean-exit and input-acceptance gates
      // (`execution-observation.ts:534-537`, `:671-673`), which stay with it
      // until step 5 makes them explicit, so both hold here.
      const state = runStateOf(facts.run);
      const runCtx: RunGuardContext = { ...entryRunContext(facts, claim, actor), exitProof: 'live_clean', inputsConfirmed: true };
      const observed = {
        kind: 'terminal_observed' as const, claim, entry, event: observation.event,
        kernelSource: observation.kernelSource, completedHistoryBoundary: observation.completedHistoryBoundary,
        history: observation.history, unresolvedToolCallIds: [],
        ...(observation.continuation === undefined ? {} : { continuation: observation.continuation }),
      };
      // Every guard is asked before the commit instant and the event id are minted
      // (they only stamp the records written), as today.
      const checked = transitionRun(state, { ...observed, endedAt: '', factEventId: '' }, runCtx);
      if (!checked.ok) return runRefusal(checked);
      const eventId = deps.eventId();
      const nowIso = deps.now();
      if (!nonEmpty(eventId) || !nonEmpty(nowIso)) return reject('unsupported', 'the injected id/clock source produced an empty value');
      const ended = transitionRun(state, { ...observed, endedAt: nowIso, factEventId: eventId }, runCtx);
      if (!ended.ok) return runRefusal(ended);
      const nextRun = nextRunOf(ended.next);
      const runRecord = encodeRun(nextRun);
      const outcome = nextRun.outcome;
      if (outcome === null) throw new Error('terminal_observed ends the Run with an outcome');
      // RUN-07's effects in this commit: the Attempt ends (ATT-06), the Outbox
      // settles (ATT-27), and only what the Run still holds is released.
      const written = claimEffectRecords(ended.effects, facts, pairingOf('terminal_observed', facts, runCtx),
        attemptEventOf({ kind: 'terminal_observed', claim, endOutcome: outcome, endedAt: nowIso, eventId,
          sequence: observation.event.sequence, entry, turnStartedAt: null }),
        { cause: 'terminal_observed', context: terminalReleaseContext });
      if (!written.ok) return written.rejection;
      const event = {
        eventId, eventType: EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: nowIso,
        identityKey: identity, actor, fingerprint, claim, entry, run: nextRun,
      };
      const mergedGuards = mergeGuards(executionReadGuards(facts, runRecord.refKey, runPin));
      if (!mergedGuards.ok) return mergedGuards.rejection;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards: mergedGuards.guards, records: [runRecord, ...written.records], claims: [],
        indexGuards: [], indexChanges: [], events: [encodeExecutionRunResultRecordedEvent(event)],
      };
      if (signal.aborted) return reject('cancelled', 'the result write was cancelled before commit');
      const receipt = await records.commit(preparedCommit);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayResult(receipt, identity, fingerprint, actor, claim, observation);
      return { status: 'committed', value: nextRun, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return unavailable(`the result write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function replayResult(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    identity: string, fingerprint: string, actor: HostActor, claim: TaskClaim,
    observation: TaskResultObservation,
  ): Promise<WriteResult<RunSnapshot>> {
    const loaded = await loadReplayEvent(records, receipt);
    if (!loaded.ok) return loaded.rejection;
    const decoded = executionRunResultRecordedEventFromEvent(loaded.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded run-result event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.identityKey !== identity || event.fingerprint !== fingerprint) return unavailable('the recorded result disagrees with the request identity');
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) return unavailable('the recorded result belongs to another actor');
    if (!sameRef(event.claim, claim) || event.entry.consumerId !== observation.entry.consumerId
      || event.entry.entryGeneration !== observation.entry.entryGeneration) {
      return unavailable('the recorded result disagrees with the request content');
    }
    return { status: 'committed', value: event.run, replayed: true, cursor: receipt.cursor };
  }

  return { authorizeRuntimeEntry, beginRuntimeEntry, recordExecutionEntered, recordRunResult };
}

// --------------------------------------------------------------------------
// Record encoders (single registered codecs, no second schema). The Attempt,
// Outbox and Session records use their owners' encoders
// (`claim-record-codecs.ts`, `session-record-codecs.ts`); every record passed
// to an encoder comes from a `state/` machine (STATE-MACHINES-SPEC §14.2).
// --------------------------------------------------------------------------

function encodeRun(run: RunSnapshot): EncodedRecord {
  return { refKey: refKeyOf(run.ref) as string, schemaId: 'RunSnapshot@1', revision: run.revision, json: JSON.stringify(run) };
}
function encodeLease(lease: TaskLeaseSnapshot): EncodedRecord {
  return { refKey: refKeyOf(lease.ref) as string, schemaId: 'TaskLeaseSnapshot@1', revision: lease.revision, json: JSON.stringify(lease) };
}

// --------------------------------------------------------------------------
// Additional shape checks
// --------------------------------------------------------------------------

function preparedEnvelopeProblem(envelope: Record<string, unknown>, claim: TaskClaim): CoreRejection | null {
  if (envelope['schemaVersion'] !== 1) return invalid('the prepared envelope schemaVersion must be 1');
  if (!nonEmpty(envelope['envelopeId'])) return invalid('the prepared envelope requires an envelopeId');
  if (!sameRef(envelope['runRef'], claim.runRef) || !sameRef(envelope['attemptRef'], claim.attemptRef)
    || !sameRef(envelope['planRef'], claim.planRef)) {
    return invalid('the prepared envelope identity disagrees with the claim');
  }
  if (envelope['projectId'] !== claim.task.projectId || envelope['goalId'] !== claim.task.goalId
    || envelope['taskId'] !== claim.task.taskId || envelope['workspaceId'] !== claim.workspaceId) {
    return invalid('the prepared envelope scope disagrees with the claim');
  }
  if (!isRoleBinding(envelope['roleBinding'])) return invalid('the prepared envelope roleBinding is incomplete');
  if (!isWorkspacePin(envelope['workspaceSnapshot'])) return invalid('the prepared envelope workspaceSnapshot is incomplete');
  if (!isPermissions(envelope['permissions'])) return invalid('the prepared envelope permissions are incomplete');
  if (!isBudget(envelope['budget'])) return invalid('the prepared envelope budget is incomplete');
  if (!Array.isArray(envelope['sourceRefs'])) return invalid('the prepared envelope sourceRefs must be an array');
  if (!isArtifactRef(envelope['bundleRef'])) return invalid('the prepared envelope bundleRef must be an ArtifactRef');
  return null;
}

function manifestAgainstPrepared(
  manifest: PreparedTaskManifestV1,
  prepared: PreparedTaskExecution,
  facts: TaskExecutionRecord,
  bodyDigest: string,
  scope: WorkspaceScope,
): CoreRejection | null {
  if (!sameRef(manifest.claim, facts.outbox.claim)) return invalid('the saved manifest claim disagrees with the persisted claim');
  if (!sameRef(manifest.roleBinding, prepared.envelope.roleBinding)) return forbidden('the saved manifest role binding disagrees with the envelope');
  if (!sameRef(manifest.workspaceSnapshot, prepared.envelope.workspaceSnapshot)) {
    return forbidden('the saved manifest workspace snapshot disagrees with the envelope');
  }
  if (!sameRef(manifest.budget, prepared.envelope.budget)) return forbidden('the saved manifest budget disagrees with the envelope');
  if (!sameRef(manifest.permissions, prepared.envelope.permissions)) {
    return forbidden('the saved manifest permissions disagree with the envelope');
  }
  if (!sameRef(manifest.sourceRefs, prepared.envelope.sourceRefs)) return forbidden('the saved manifest sources disagree with the envelope');
  if (!sameRef(manifest.sessionRole, facts.session.role)) return forbidden('the saved manifest session role disagrees with the Session');
  if (manifest.workspaceSnapshot.workspaceId !== scope.workspaceId) return forbidden('the saved manifest workspace is outside the Host scope');
  if (manifest.inputDigest !== artifactBodyDigest(manifest.input)) return invalid('the saved manifest inputDigest does not match its input');
  const binding = prepared.inputBinding;
  if (binding.inputDigest !== manifest.inputDigest) return invalid('the input binding digest disagrees with the saved manifest input');
  if (binding.manifestDigest !== bodyDigest) return invalid('the input binding manifestDigest disagrees with the saved manifest body');
  if (!sameRef(binding.materialAccessRefs, manifest.materialAccessRefs)) {
    return forbidden('the input binding material access refs disagree with the saved manifest');
  }
  if (!sameRef(binding.deliveryRefs, manifest.deliveryRefs)) return forbidden('the input binding delivery refs disagree with the saved manifest');
  if (!sameRef(binding.additionalMaterialRefs ?? [], manifest.additionalMaterialRefs)) {
    return forbidden('the input binding additional materials disagree with the saved manifest');
  }
  return null;
}

export function taskEntryPermitProblem(permit: unknown): string | null {
  if (!isRecord(permit)) return 'the entry permit must be an object';
  const claimProblem = taskClaimProblem(permit['claim']);
  if (claimProblem !== null) return claimProblem;
  if (!nonEmpty(permit['consumerId'])) return 'the entry permit consumerId is required';
  if (!isPositiveSafeInteger(permit['entryGeneration'])) return 'the entry permit entryGeneration must be a positive safe integer';
  if (!isPositiveSafeInteger(permit['authorizationRevision'])) return 'the entry permit authorizationRevision must be a positive safe integer';
  if (!isSha256Hex(permit['inputDigest'])) return 'the entry permit inputDigest must be a sha256 hex';
  return null;
}

function observedHistoryProblem(history: unknown): boolean {
  // ObservedExecutionHistory carries only the Kernel identity/positions; the
  // SessionRef comes from the claim and is added by the shared compiler.
  if (!isRecord(history) || !isKernelBinding(history['kernel'])) return false;
  if (!isPositiveSafeInteger(history['startPosition']) || !isPositiveSafeInteger(history['observedThroughPosition'])) return false;
  if (!(history['endPosition'] === null || isPositiveSafeInteger(history['endPosition']))) return false;
  return true;
}

/**
 * The ONE guard merge used by every entry/model commit. Duplicate guards for the
 * same key must agree; a conflict is a real `revision_conflict` and is NEVER
 * silently reduced to the larger/first/last version. Callers rebuild the whole
 * read window instead of inventing a winner.
 */
export function mergeGuards(guards: readonly RecordGuard[]):
  { ok: true; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection } {
  const byKey = new Map<string, number | null>();
  for (const guard of guards) {
    if (guard.refKey === '') return { ok: false, rejection: invalid('a record guard has an empty refKey') };
    const existing = byKey.get(guard.refKey);
    if (existing === undefined) { byKey.set(guard.refKey, guard.expectedRevision); continue; }
    if (existing !== guard.expectedRevision) {
      return { ok: false, rejection: reject('revision_conflict', `conflicting guards for ${guard.refKey}`) };
    }
  }
  return { ok: true, guards: [...byKey].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision })) };
}

function mapReaderRejection(rejection: import('./plan-readers.js').Rejected): CoreRejection {
  return reject(rejection.code, rejection.reason);
}
