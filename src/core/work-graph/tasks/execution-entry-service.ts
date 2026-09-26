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
 */
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import { ARTIFACT_MAX_SIZE_BYTES, artifactBodyDigest, artifactBodySize, type ArtifactRecord, type ArtifactRef } from '../../../contracts/artifact.js';
import type {
  ExecutionAuthorizationV2, RoleBindingRefV1, RunOutcome, RunRef, RunSnapshot, RuntimeEventV1,
  RuntimeInputBindingV1, TaskAttemptSnapshot, TaskBudgetV1, TaskLeaseSnapshot, TaskTriple,
} from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { sameArtifactRef, validMaterialSourcePin, type MaterialBasisV1 } from '../../../contracts/material-access.js';
import type { PlanRevisionSnapshot, TaskInputRequirementV2 } from '../../../contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../../contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../../contracts/task-envelope.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import type { RawArtifactRecord } from '../../record-store/body-ports.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt, StoreFailure,
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
  inputBindingProblem, isExecutionAuthorizationV2, taskDispatchStateV1Problem,
} from '../persistence/execution-entry-codecs.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { dispatchOutboxRefKey, taskAttemptRefKey, taskClaimProblem } from './claim-record-codecs.js';
import type { TaskClaimOutbox } from './claim-contracts.js';
import type { GraphWrite } from './contracts.js';
import { compileExecutionHistoryBinding } from './execution-history-binding.js';
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

/**
 * The ONE shared fresh-action barrier against the Run's canonical control
 * pointer, called at exactly three audited points: after the original receipt
 * lookup misses in `authorizeRuntimeEntry` and `beginRuntimeEntry`, and after
 * the facts read in the shared `admitEnteredRun` (both model barriers). An
 * absent `controlState` is the historical behavior. A queued pause/cancel is a
 * real fence and fails the fresh action `busy`; it never claims the Run already
 * stopped. A present `running`/`steered` pointer still has no unblock proof in
 * this batch, so it fails closed as `unsupported` and is never treated as an
 * absent field. The gate is deliberately NOT in `readAdmissionFacts`, because
 * entered/result re-reads must stay free of it.
 */
export function freshRunControlProblem(run: RunSnapshot): CoreRejection | null {
  const control = run.controlState;
  if (control === undefined) return null;
  if (control.desiredState === 'paused' || control.desiredState === 'cancelled') {
    return busy(`the Run is fenced by a queued ${control.desiredState} control intent (${control.intentRef.intentId}); no fresh execution action is admitted`);
  }
  return reject('unsupported',
    `the Run carries a ${control.desiredState} control pointer (${control.intentRef.intentId}) that this stage does not implement`);
}
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
    run: input.run, sessionRole: input.sessionRole, configurationRevision: input.configurationRevision,
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
  const enteredControl = freshRunControlProblem(factsRead.value.run);
  if (enteredControl !== null) return { ok: false, rejection: enteredControl };
  const { run, outbox, session } = factsRead.value;
  const auth = run.executionAuthorization;
  if (!isExecutionAuthorizationV2(auth)) return { ok: false, rejection: forbidden('the Run has no formal V2 entry authorization') };
  if (auth.phase !== 'entered') return { ok: false, rejection: busy('the Run entry is not entered') };
  if (run.status !== 'running') return { ok: false, rejection: busy('the Run is not running') };
  if (!sameRef(outbox.claim, permit.claim)) return { ok: false, rejection: invalid('the entry permit claim disagrees with the persisted claim') };
  if (auth.consumerId !== permit.consumerId || auth.generation !== permit.entryGeneration
    || auth.revision !== permit.authorizationRevision || auth.inputDigest !== permit.inputDigest) {
    return { ok: false, rejection: forbidden('the entry permit does not match the current V2 entry binding') };
  }
  if (auth.sessionGeneration !== permit.claim.generation) {
    return { ok: false, rejection: forbidden('the V2 entry binding session generation disagrees with the claim') };
  }
  if (outbox.claim.sessionRef.projectId !== session.ref.projectId
    || outbox.claim.sessionRef.sessionId !== session.ref.sessionId) {
    return { ok: false, rejection: unavailable('the claim Session mapping changed') };
  }
  const admittedOwnership = sessionOccupancyProblem(session, permit.claim);
  if (admittedOwnership !== null) return { ok: false, rejection: admittedOwnership };
  const lease = factsRead.value.lease;
  const leaseProblem = leaseOwnershipProblem(lease, permit.claim);
  if (leaseProblem !== null) return { ok: false, rejection: leaseProblem };
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
  const hostRole = await recheckHostRoleAdmission(deps, ctx, {
    run, manifestRole: manifest.role, sessionRole: session.role,
    roleBinding: run.roleBinding, permissions: manifest.permissions,
    hostTemplate: manifest.hostTemplate, configurationRevision: manifest.hostConfigurationRevision,
  });
  if (!hostRole.ok) return hostRole;
  const nowIso = deps.now();
  const deadline = deadlineProblem(run, nowIso);
  if (deadline !== null) return { ok: false, rejection: deadline };
  const material = await admitExternalMaterials(deps, ctx, factsRead.value, manifest);
  if (!material.ok) return material;
  return { ok: true, value: { facts: factsRead.value, auth, manifest, inputBinding,
    roleFacts: hostRole.value.roleFacts, materialGuards: material.value.guards } };
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

/** The ONE accepted prepared-manifest body content type. */
export const MANIFEST_CONTENT_TYPE = 'application/vnd.coding-platform.task-execution-manifest+json;version=1';

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
      const authorizeControl = freshRunControlProblem(factsRead.value.run);
      if (authorizeControl !== null) return authorizeControl;
      if (signal.aborted) return reject('cancelled', 'the authorization was cancelled during the execution read');
      const facts = factsRead.value;
      if (facts.run.status !== 'starting') return busy('the Run is not in a claimable starting state');
      const ownership = sessionOccupancyProblem(facts.session, claim);
      if (ownership !== null) return ownership;
      const lease = facts.lease;
      const leaseProblem = leaseOwnershipProblem(lease, claim);
      if (leaseProblem !== null) return leaseProblem;
      if (!sameRef(facts.outbox.claim, claim)) return invalid('the prepared claim disagrees with the persisted claim');
      if (!sameRef(prepared.envelope.roleBinding, facts.run.roleBinding)) return forbidden('the prepared role binding disagrees with the Run');
      if (!sameRef(prepared.envelope.budget, facts.run.budget)) return forbidden('the prepared budget disagrees with the Run');
      if (!sameRef(prepared.envelope.workspaceSnapshot, facts.run.workspaceSnapshot)) {
        return forbidden('the prepared workspace snapshot disagrees with the Run');
      }
      if (facts.run.executionAuthorization !== undefined) {
        return isExecutionAuthorizationV2(facts.run.executionAuthorization)
          ? busy('the Run already has a V2 entry authorization')
          : forbidden('the Run has a legacy V1 authorization that cannot be upgraded into a fresh begin');
      }

      // Current Goal/Workspace scope facts and their exact guards.
      const goalScope = await readGoalScope(records, goalRefOf(claim.task));
      if (goalScope.status !== 'ready') return mapReaderRejection(goalScope);
      if (goalScope.goal.desiredState !== 'active') return busy('the Goal is not active');
      if (goalScope.goal.activePlanRevision === null || !sameRef(goalScope.goal.activePlanRevision, claim.planRef)) {
        return reject('revision_conflict', 'the requested Plan is no longer the Goal active pin');
      }
      if (goalScope.goal.workspaceRef.workspaceId !== claim.workspaceId) return forbidden('the Goal belongs to another workspace');

      const stored = await readManifestFromEnvelope(deps, prepared.envelope as unknown as Record<string, unknown>, claim.runRef);
      if (!stored.ok) return stored.rejection;
      const manifest = stored.value.manifest;
      const manifestRejection = manifestAgainstPrepared(manifest, prepared, facts, stored.value.bodyDigest, scope);
      if (manifestRejection !== null) return manifestRejection;
      const hostRole = await recheckHostRoleAdmission(deps, scopeCtx, {
        run: facts.run, manifestRole: manifest.role, sessionRole: facts.session.role,
        roleBinding: facts.run.roleBinding, permissions: manifest.permissions,
        hostTemplate: manifest.hostTemplate, configurationRevision: manifest.hostConfigurationRevision,
      });
      if (!hostRole.ok) return hostRole.rejection;
      const deadline = deadlineProblem(facts.run, deps.now());
      if (deadline !== null) return deadline;
      const material = await admitExternalMaterials(deps, scopeCtx, facts, manifest);
      if (!material.ok) return material.rejection;

      const permit: TaskEntryPermit = {
        claim, consumerId, entryGeneration: 1, authorizationRevision: 1,
        inputDigest: prepared.inputBinding.inputDigest,
      };
      const authorization: ExecutionAuthorizationV2 = {
        schemaVersion: 2, generation: permit.entryGeneration, sessionGeneration: claim.generation,
        revision: permit.authorizationRevision, consumerId, inputDigest: permit.inputDigest,
        phase: 'authorized', kernel: null,
      };
      const nextRun: RunSnapshot = { ...facts.run, revision: facts.run.revision + 1,
        envelope: prepared.envelope, inputBinding: prepared.inputBinding, executionAuthorization: authorization };
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
        { refKey: runRecord.refKey, expectedRevision: runPin.revision },
        { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
        { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
        { refKey: planRevisionRefKey(facts.plan.ref), expectedRevision: facts.plan.revision },
        { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(facts.outbox.claim.sessionRef)), expectedRevision: facts.session.revision },
        { refKey: refKeyOf(lease!.ref) as string, expectedRevision: lease!.revision },
        { refKey: goalKey, expectedRevision: goalScope.goal.revision },
        { refKey: goalScope.workspaceKey, expectedRevision: goalScope.workspaceRevision },
        ...hostRole.value.roleFacts.guards,
        ...material.value.guards,
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
      const beginControl = freshRunControlProblem(factsRead.value.run);
      if (beginControl !== null) return beginControl;
      if (signal.aborted) return reject('cancelled', 'the begin was cancelled during the execution read');
      const facts = factsRead.value;
      if (facts.run.status !== 'starting') return busy('the Run is not in a beginable starting state');
      if (!sameRef(facts.outbox.claim, permit.claim)) return invalid('the entry permit claim disagrees with the persisted claim');
      const auth = facts.run.executionAuthorization;
      if (!isExecutionAuthorizationV2(auth)) return forbidden('the Run has no formal V2 entry authorization');
      if (auth.phase !== 'authorized') return busy('the Run entry is not in the authorized phase');
      if (auth.consumerId !== permit.consumerId || auth.generation !== permit.entryGeneration
        || auth.revision !== permit.authorizationRevision || auth.inputDigest !== permit.inputDigest) {
        return forbidden('the entry permit does not match the current V2 entry binding');
      }
      if (auth.sessionGeneration !== permit.claim.generation) {
        return forbidden('the V2 entry binding session generation disagrees with the claim');
      }
      const ownership = sessionOccupancyProblem(facts.session, permit.claim);
      if (ownership !== null) return ownership;
      const lease = facts.lease;
      const leaseProblem = leaseOwnershipProblem(lease, permit.claim);
      if (leaseProblem !== null) return leaseProblem;

      const stored = await readStoredManifest(deps, facts.run);
      if (!stored.ok) return stored.rejection;
      const manifest = stored.value.manifest;
      if (!facts.run.inputBinding || facts.run.inputBinding.inputDigest !== permit.inputDigest) {
        return forbidden('the Run input binding disagrees with the entry permit');
      }
      const hostRole = await recheckHostRoleAdmission(deps, scopeCtx, {
        run: facts.run, manifestRole: manifest.role, sessionRole: facts.session.role,
        roleBinding: facts.run.roleBinding, permissions: manifest.permissions,
        hostTemplate: manifest.hostTemplate, configurationRevision: manifest.hostConfigurationRevision,
      });
      if (!hostRole.ok) return hostRole.rejection;
      const deadline = deadlineProblem(facts.run, deps.now());
      if (deadline !== null) return deadline;
      const material = await admitExternalMaterials(deps, scopeCtx, facts, manifest);
      if (!material.ok) return material.rejection;

      const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'entering', kernel };
      const nextRun: RunSnapshot = { ...facts.run, revision: facts.run.revision + 1, executionAuthorization: nextAuthorization };
      const runRecord = encodeRun(nextRun);
      const entry: RuntimeEntryRecord = { runRef: facts.run.ref, runRevision: nextRun.revision, authorization: nextAuthorization };
      const event = {
        eventId: deps.eventId(), eventType: EXECUTION_ENTRY_BEGUN_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: deps.now(),
        identityKey: identity, actor, fingerprint, permit, kernel, entry,
      };
      if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return reject('unsupported', 'the injected id/clock source produced an empty value');
      const slotKey = 'execution-history-kernel:' + canonicalJson({ adapterId: kernel.adapterId,
        kernelSessionId: kernel.kernelSessionId, runId: kernel.runId, turnId: kernel.turnId } as unknown as JsonValue);
      const runKey = runRecord.refKey;
      const merged = mergeGuards([
        { refKey: runKey, expectedRevision: runPin.revision },
        { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
        { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
        { refKey: planRevisionRefKey(facts.plan.ref), expectedRevision: facts.plan.revision },
        { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(facts.outbox.claim.sessionRef)), expectedRevision: facts.session.revision },
        { refKey: refKeyOf(lease!.ref) as string, expectedRevision: lease!.revision },
        ...hostRole.value.roleFacts.guards,
        ...material.value.guards,
      ]);
      if (!merged.ok) return merged.rejection;
      const guards = merged.guards;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards, records: [runRecord],
        claims: [{ claimKey: slotKey, expectedOwner: null, nextOwner: runKey }],
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
      if (!sameRef(facts.outbox.claim, permit.claim)) return invalid('the entry permit claim disagrees with the persisted claim');
      const auth = facts.run.executionAuthorization;
      if (!isExecutionAuthorizationV2(auth)) return forbidden('the Run has no formal V2 entry authorization');
      if (auth.phase !== 'entering') return busy('the Run entry is not in the entering phase');
      if (auth.consumerId !== permit.consumerId || auth.generation !== permit.entryGeneration
        || auth.revision !== permit.authorizationRevision || auth.inputDigest !== permit.inputDigest) {
        return forbidden('the entry permit does not match the current V2 entry binding');
      }
      if (auth.sessionGeneration !== permit.claim.generation) {
        return forbidden('the V2 entry binding session generation disagrees with the claim');
      }
      const enteredOwnership = sessionOccupancyProblem(facts.session, permit.claim);
      if (enteredOwnership !== null) return enteredOwnership;
      const enteredLease = facts.lease;
      const enteredLeaseProblem = leaseOwnershipProblem(enteredLease, permit.claim);
      if (enteredLeaseProblem !== null) return enteredLeaseProblem;
      if (auth.kernel === null || !sameKernel(auth.kernel, kernelSource)) {
        return forbidden('the entered Kernel source disagrees with the begin binding');
      }
      if (!isRecord(history.kernel) || !sameKernel(history.kernel as KernelExecutionBinding, kernelSource)) {
        return forbidden('the observed history Kernel identity disagrees with the entered source');
      }
      if (kernelSource.position < history.startPosition || kernelSource.position > history.observedThroughPosition) {
        return invalid('the entered Kernel position is outside the observed history range');
      }
      // The entered fact is already-occurred evidence: it must not re-apply the
      // fresh Host/Role/material admission gates here. authorize/begin and the
      // model barriers keep those; this write keeps only the original permit,
      // claim, Run/Kernel/Session/Lease identity and the real history source.
      const compiled = compileExecutionHistoryBinding({
        run: facts.run, session: facts.session, sessionRef: permit.claim.sessionRef,
        kernel: kernelSource, startPosition: history.startPosition,
        observedThroughPosition: history.observedThroughPosition, endPosition: history.endPosition,
        beginOwnerRefKey: refKeyOf(facts.run.ref),
      });
      if (compiled.status !== 'compiled') return compiled;
      const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'entered' };
      const nextRun: RunSnapshot = { ...compiled.value.nextRun, status: 'running', startedAt: enteredAt,
        executionAuthorization: nextAuthorization };
      const runRecord = encodeRun(nextRun);
      const nextAttempt: TaskAttemptSnapshot = { ...facts.attempt, revision: facts.attempt.revision + 1,
        status: 'started', startedAt: enteredAt };
      const attemptRecord = encodeAttempt(nextAttempt);
      const eventId = deps.eventId();
      if (!nonEmpty(eventId)) return reject('unsupported', 'the injected id source produced an empty event id');
      const nextOutbox: TaskClaimOutbox = { ...facts.outbox, revision: facts.outbox.revision + 1, status: 'entered',
        dispatchState: { schemaVersion: 1, phase: 'entered', consumerId: permit.consumerId,
          entryGeneration: permit.entryGeneration, sessionGeneration: permit.claim.generation, eventId } };
      const outboxRecord = encodeOutbox(nextOutbox);
      const event = {
        eventId, eventType: EXECUTION_ENTRY_ENTERED_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: deps.now(),
        identityKey: identity, actor, fingerprint, permit, run: nextRun,
      };
      const merged = mergeGuards([
        { refKey: runRecord.refKey, expectedRevision: runPin.revision },
        { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
        { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
        { refKey: planRevisionRefKey(facts.plan.ref), expectedRevision: facts.plan.revision },
        { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(facts.outbox.claim.sessionRef)), expectedRevision: facts.session.revision },
        { refKey: refKeyOf(enteredLease!.ref) as string, expectedRevision: enteredLease!.revision },
      ]);
      if (!merged.ok) return merged.rejection;
      const guards = merged.guards;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards, records: [runRecord, attemptRecord, outboxRecord], claims: [],
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
    const checkedRun = checkRunPin(owned.expected, claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return reject('cancelled', 'the result write was cancelled before lookup');

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(ENTRY_RESULT_PREFIX, actor, scope, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-entry-result', actor: { kind: actor.kind, id: actor.id },
        claim, entry: { consumerId: observation.entry.consumerId, entryGeneration: observation.entry.entryGeneration },
        event: observation.event, kernelSource: observation.kernelSource,
        completedHistoryBoundary: observation.completedHistoryBoundary, history: observation.history,
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
      if (!sameRef(facts.outbox.claim, claim)) return invalid('the result claim disagrees with the persisted claim');
      const auth = facts.run.executionAuthorization;
      if (!isExecutionAuthorizationV2(auth)) return forbidden('the Run has no formal V2 entry authorization');
      if (auth.phase !== 'entered') return busy('the Run entry is not in the entered phase');
      if (runFinished(facts.run)) return busy('the Run already has a terminal result');
      if (auth.consumerId !== observation.entry.consumerId || auth.generation !== observation.entry.entryGeneration) {
        return forbidden('the result entry projection does not match the current V2 entry binding');
      }
      const kernelSource = observation.kernelSource;
      const boundary = observation.completedHistoryBoundary;
      const history = observation.history;
      if (kernelSource === null || boundary === null || history === null) {
        return incomplete('a terminal result requires the complete observed Turn boundary');
      }
      if (!isKernelObservationSource(kernelSource)) return invalid('the terminal Kernel source is incomplete');
      if (auth.kernel === null || !sameKernel(auth.kernel, kernelSource)) {
        return forbidden('the terminal Kernel source disagrees with the entered binding');
      }
      if (!isRecord(boundary.source) || !sameKernel(boundary.source as KernelExecutionBinding, kernelSource)
        || boundary.source.position !== kernelSource.position || !nonEmpty(boundary.cursor)) {
        return invalid('the completed history boundary disagrees with the terminal source');
      }
      if (!isRecord(history.kernel) || !sameKernel(history.kernel as KernelExecutionBinding, kernelSource)) {
        return forbidden('the observed history Kernel identity disagrees with the terminal source');
      }
      if (history.endPosition !== kernelSource.position || history.observedThroughPosition < kernelSource.position
        || history.startPosition > kernelSource.position) {
        return incomplete('the observed history does not carry the complete Turn end boundary');
      }
      const terminal = terminalFact(observation.event, claim.runRef, facts.run);
      if ('status' in terminal) return terminal;
      // Terminal reduction records an already-entered fact: it does NOT re-apply
      // the new-action Host/Role/material admission gates. Only the Kernel/begin/
      // claim/entry/Turn provenance below is required.
      const compiled = compileExecutionHistoryBinding({
        run: facts.run, session: facts.session, sessionRef: claim.sessionRef,
        kernel: kernelSource, startPosition: history.startPosition,
        observedThroughPosition: history.observedThroughPosition, endPosition: history.endPosition,
        beginOwnerRefKey: refKeyOf(facts.run.ref),
      });
      if (compiled.status !== 'compiled') return compiled;

      const eventId = deps.eventId();
      const nowIso = deps.now();
      if (!nonEmpty(eventId) || !nonEmpty(nowIso)) return reject('unsupported', 'the injected id/clock source produced an empty value');
      const ownsSession = sessionOwnedByRun(facts.session, claim);
      const ownsLease = facts.lease !== null && facts.lease.holderRunId === claim.runRef.runId
        && facts.lease.attemptId === claim.attemptRef.attemptId && facts.lease.release === undefined;
      const nextAuthorization: ExecutionAuthorizationV2 = { ...auth, revision: auth.revision + 1, phase: 'settled' };
      const nextRun: RunSnapshot = { ...compiled.value.nextRun, status: 'ended', outcome: terminal.outcome,
        exitCode: terminal.exitCode, endedAt: nowIso, executionAuthorization: nextAuthorization,
        lastEventSeq: observation.event.sequence, lastRuntimeEventId: observation.event.eventId,
        lastFactEventId: eventId };
      const runRecord = encodeRun(nextRun);
      const nextAttempt: TaskAttemptSnapshot = { ...facts.attempt, revision: facts.attempt.revision + 1,
        status: 'ended', endedAt: nowIso, endOutcome: terminal.outcome };
      const nextOutbox: TaskClaimOutbox = { ...facts.outbox, revision: facts.outbox.revision + 1, status: 'settled',
        dispatchState: { schemaVersion: 1, phase: 'settled', consumerId: auth.consumerId,
          entryGeneration: auth.generation, sessionGeneration: claim.generation, eventId } };
      const encoded: EncodedRecord[] = [runRecord, encodeAttempt(nextAttempt), encodeOutbox(nextOutbox)];
      const guardList: RecordGuard[] = [
        { refKey: runRecord.refKey, expectedRevision: runPin.revision },
        { refKey: taskAttemptRefKey(facts.attempt.ref), expectedRevision: facts.attempt.revision },
        { refKey: dispatchOutboxRefKey(facts.outbox.ref), expectedRevision: facts.outbox.revision },
        { refKey: planRevisionRefKey(facts.plan.ref), expectedRevision: facts.plan.revision },
        { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(claim.sessionRef)), expectedRevision: facts.session.revision },
      ];
      if (facts.lease !== null) {
        // The Lease is read to decide the release: its exact local version must
        // be in the same commit, whether or not this Run still owns/releases it.
        guardList.push({ refKey: refKeyOf(facts.lease.ref) as string, expectedRevision: facts.lease.revision });
      }
      if (ownsLease) {
        const lease = facts.lease as TaskLeaseSnapshot;
        const nextLease: TaskLeaseSnapshot = { ...lease, revision: lease.revision + 1,
          release: { schemaVersion: 1, runRef: claim.runRef, attemptRef: claim.attemptRef,
            sessionRef: claim.sessionRef, generation: claim.generation, releasedAt: nowIso, eventId } };
        encoded.push(encodeLease(nextLease));
      }
      if (ownsSession) {
        const nextSession: SessionRecord = { ...facts.session, revision: facts.session.revision + 1,
          occupancy: null, lastExecutionRef: claim.runRef, historyCursor: boundary.cursor };
        encoded.push(encodeSession(nextSession));
        // The Session guard was already added above.
      }
      const event = {
        eventId, eventType: EXECUTION_RUN_RESULT_RECORDED_EVENT_TYPE,
        schemaVersion: EXECUTION_ENTRY_EVENT_SCHEMA_VERSION, occurredAt: nowIso,
        identityKey: identity, actor, fingerprint, claim,
        entry: { consumerId: auth.consumerId, entryGeneration: auth.generation }, run: nextRun,
      };
      const mergedGuards = mergeGuards(guardList);
      if (!mergedGuards.ok) return mergedGuards.rejection;
      const preparedCommit: PreparedCommit = {
        identityKey: identity, fingerprint, guards: mergedGuards.guards, records: encoded, claims: [],
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
// Record encoders (single registered codecs, no second schema)
// --------------------------------------------------------------------------

function encodeRun(run: RunSnapshot): EncodedRecord {
  return { refKey: refKeyOf(run.ref) as string, schemaId: 'RunSnapshot@1', revision: run.revision, json: JSON.stringify(run) };
}
function encodeAttempt(attempt: TaskAttemptSnapshot): EncodedRecord {
  return { refKey: taskAttemptRefKey(attempt.ref), schemaId: 'TaskAttemptSnapshot@1', revision: attempt.revision, json: JSON.stringify(attempt) };
}
function encodeOutbox(outbox: TaskClaimOutbox): EncodedRecord {
  return { refKey: dispatchOutboxRefKey(outbox.ref), schemaId: 'DispatchOutboxEntrySnapshot@1', revision: outbox.revision, json: JSON.stringify(outbox) };
}
function encodeLease(lease: TaskLeaseSnapshot): EncodedRecord {
  return { refKey: refKeyOf(lease.ref) as string, schemaId: 'TaskLeaseSnapshot@1', revision: lease.revision, json: JSON.stringify(lease) };
}
function encodeSession(session: SessionRecord): EncodedRecord {
  return { refKey: sessionAggregateRefKey(session.ref), schemaId: 'SessionRecord@1', revision: session.revision, json: JSON.stringify(session) };
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

function leaseOwnershipProblem(lease: TaskLeaseSnapshot | null, claim: TaskClaim): CoreRejection | null {
  // A missing Lease is never "free": entry admission requires the claim's exact
  // present, unreleased Lease whose full TaskRef/holder/attempt still match.
  if (lease === null) return busy('the claim TaskLease is missing; a missing lease is not free');
  if (lease.release !== undefined) return busy('the claim TaskLease was already released');
  if (lease.ref.projectId !== claim.task.projectId || lease.ref.goalId !== claim.task.goalId
    || lease.ref.taskId !== claim.task.taskId) {
    return busy('the claim TaskLease names another Task');
  }
  if (lease.holderRunId !== claim.runRef.runId || lease.attemptId !== claim.attemptRef.attemptId) {
    return busy('the claim TaskLease is held by another attempt');
  }
  return null;
}

function sessionOccupancyProblem(session: SessionRecord, claim: TaskClaim): CoreRejection | null {
  if (session.lifecycle !== 'active') return busy('the claim Session is archived');
  if (session.health !== 'available') return busy('the claim Session is not available');
  const occupancy = session.occupancy;
  if (occupancy === null || occupancy.kind !== 'execution' || !sameRef(occupancy.executionRef, claim.runRef)
    || occupancy.generation !== claim.generation) {
    return busy('the claim Session is no longer occupied by this Run generation');
  }
  return null;
}

function sessionOwnedByRun(session: SessionRecord, claim: TaskClaim): boolean {
  return session.occupancy !== null && session.occupancy.kind === 'execution'
    && sameRef(session.occupancy.executionRef, claim.runRef) && session.occupancy.generation === claim.generation;
}

function runFinished(run: RunSnapshot): boolean {
  return run.status === 'ended' || run.outcome !== null;
}

function terminalFact(event: RuntimeEventV1, runRef: RunRef, run: RunSnapshot): { outcome: RunOutcome; exitCode: number | null } | CoreRejection {
  if (!isRecord(event)) return invalid('the result event must be an object');
  if (!sameRef(event.runRef, runRef)) return invalid('the result event names another Run');
  if (!nonEmpty(event.eventId)) return invalid('the result event requires an eventId');
  if (event.schemaVersion !== 1) return invalid('the result event schemaVersion must be 1');
  if (!isSafeInteger(event.sequence)) return invalid('the result event sequence must be a safe non-negative integer');
  if (event.sequence <= run.lastEventSeq) return reject('revision_conflict', 'the result event sequence is not newer than the applied Run fact');
  if (!isRecord(event.payload)) return invalid('the result event payload must be an object');
  switch (event.eventType) {
    case 'run_completed':
      if (event.payload.kind !== 'completed' || !Number.isSafeInteger(event.payload.exitCode)) {
        return invalid('run_completed requires a completed payload with an exitCode');
      }
      return { outcome: 'completed', exitCode: event.payload.exitCode as number };
    case 'run_crashed':
      if (event.payload.kind !== 'crashed' || typeof event.payload.error !== 'string') return invalid('run_crashed requires a crashed payload');
      return { outcome: 'crashed', exitCode: null };
    case 'run_cancelled':
      if (event.payload.kind !== 'cancelled' || typeof event.payload.reason !== 'string') return invalid('run_cancelled requires a cancelled payload');
      return { outcome: 'cancelled', exitCode: null };
    case 'run_budget_exhausted':
      if (event.payload.kind !== 'budget_exhausted' || typeof event.payload.exhaustedAt !== 'string') {
        return invalid('run_budget_exhausted requires a budget_exhausted payload');
      }
      return { outcome: 'budget_exhausted', exitCode: null };
    default:
      return invalid('a terminal result requires a terminal Runtime event');
  }
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
