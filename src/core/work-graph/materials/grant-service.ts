/**
 * M1 material grant service — the single WorkGraph writer for Host-issued
 * exact-material read authorization.
 *
 * SCOPE OF THIS BATCH (Host-only, current-only, same project/workspace/goal):
 *   grantMaterialAccess
 *     1. synchronously snapshots ctx principal/materialReader/scope, the request
 *        body and the original AbortSignal before the first await;
 *     2. admits ONLY a trusted human/system Host actor that exactly matches
 *        `ctx.materialReader.actor`, with `ctx.workspaceId` present; a
 *        work_run / query_run writer is forbidden;
 *     3. validates the full GoalRef, Workspace, reader Run and each material via
 *        the existing `MaterialPort.openArtifact` under the Host's own
 *        historical_explanation context, then cross-checks the REAL owner Run
 *        through `MaterialAuthorityReads` (never trusts caller/owner labels);
 *     4. calls the real `SourceApplicabilityPort.capture` for the exact
 *        workspace_paths sourceSet and refuses unavailable/stale/rejected;
 *     5. re-reads Goal/Workspace/reader/owner after the capture, builds the
 *        basis from the reader's accepted active Plan, the formal Workspace
 *        revision and the captured pin, forms the Control issuedBy, and commits
 *        one CAS@0 `MaterialAccessGrantSnapshot@1` with Goal/Workspace/reader/
 *        owner guards;
 *     6. restores the ORIGINAL receipt/cursor on an idempotent replay before any
 *        new source capture; identityKey/fingerprint keep sourcePin and the
 *        clock out of the request fingerprint.
 *
 *   revokeMaterialAccess
 *     - admits only the trusted Host in the grant's own scope, allows revocation
 *       even when source/Plan/basis are no longer current, and commits exactly
 *       CAS revision 1 -> 2 with the real reason/revokedAt/actor/commandId.
 *
 *   Cross-workspace history, QueryRun readers and owner-Agent issuance stay out
 *   of scope and remain explicit rejections. A grant only authorizes reading:
 *   it never refreshes a report's historical sourceRefs and never creates
 *   Evidence or a completion verdict.
 *
 * The composition root injects the SAME real SourceApplicabilityPort instance
 * here and into `createMaterialAccessResolver(authority, index, source)`.
 */
import type { CoreCallContext, CorePrincipal, MaterialReader } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../../contracts/artifact.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type {
  MaterialAccessGrantRef,
  MaterialAccessGrantSnapshot,
  MaterialAccessGrantV1,
  MaterialAccessScopeV1,
  MaterialBasisV1,
} from '../../../contracts/material-access.js';
import { sameArtifactRef, validMaterialSourcePin, validMaterialSourceSet } from '../../../contracts/material-access.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  EncodedRecord,
  GoalRecordTransactionPort,
  PreparedCommit,
  RecordGuard,
  StoreCommitReceipt,
  StoreFailure,
} from '../../record-store/ports.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import {
  decodeMaterialAccessGrantedEvent,
  decodeMaterialAccessRevokedEvent,
  encodeMaterialAccessGrantSnapshot,
  encodeMaterialAccessGrantedEvent,
  encodeMaterialAccessRevokedEvent,
  MATERIAL_ACCESS_GRANTED_EVENT,
  MATERIAL_ACCESS_GRANTED_SCHEMA_VERSION,
  MATERIAL_ACCESS_REVOKED_EVENT,
  MATERIAL_ACCESS_REVOKED_SCHEMA_VERSION,
  type MaterialAccessGrantedEvent,
  type MaterialAccessRevokedEvent,
  type MaterialAccessRevocationV1,
} from './grant-record-codecs.js';
import {
  MATERIAL_GRANT_MAX_MATERIALS,
  MATERIAL_GRANT_PURPOSE_MAX_BYTES,
  MATERIAL_GRANT_REASON_MAX_BYTES,
  type GrantMaterialAccessInput,
  type MaterialGrantDependencies,
  type MaterialGrantPort,
  type MaterialGrantWorkspaceSourceSet,
  type RevokeMaterialAccessInput,
} from './grant-contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

const GRANT_IDENTITY_PREFIX = 'material-access-grant:';
const REVOKE_IDENTITY_PREFIX = 'material-access-revoke:';
const GRANT_INPUT_KEYS: readonly string[] = ['goalRef', 'reader', 'materials', 'sourceSet', 'purpose'];
const REVOKE_INPUT_KEYS: readonly string[] = ['grantRef', 'reason'];

type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object' && value !== null
    && typeof (value as { aborted?: unknown }).aborted === 'boolean'
    && typeof (value as { addEventListener?: unknown }).addEventListener === 'function';
}
function trustedActor(value: unknown): value is Extract<ActorRef, { kind: 'human' | 'system' }> {
  if (!isRecord(value)) return false;
  return (value['kind'] === 'human' || value['kind'] === 'system') && nonEmpty(value['id']);
}
function sameActor(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return left['kind'] === right['kind'] && left['id'] === right['id'];
}
function refKeyOf(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}
function sameRef(left: unknown, right: unknown): boolean {
  try {
    return refKeyOf(left) === refKeyOf(right);
  } catch {
    return false;
  }
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return { status: 'rejected', code, reason, ...(current === undefined ? {} : { current }) };
}
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function notFound(reason: string): CoreRejection { return reject('not_found', reason); }
function revisionConflict(reason: string): CoreRejection { return reject('revision_conflict', reason); }
function cancelled(reason: string): CoreRejection { return reject('cancelled', reason); }
function unsupported(reason: string): CoreRejection { return reject('unsupported', reason); }

function pinsFromCurrent(current: readonly { refKey: string; revision: number | null }[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    try {
      const ref = JSON.parse(entry.refKey) as unknown;
      if (isRecord(ref)) pins.push({ ref: ref as unknown as VersionPin['ref'], revision: entry.revision });
    } catch { /* an unreadable ref key is not a pin */ }
  }
  return pins;
}

function mapStoreFailure(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': {
      const current = pinsFromCurrent(failure.current);
      return reject('revision_conflict', failure.reason, current.length > 0 ? current : undefined);
    }
    case 'unique_conflict':
      return revisionConflict(`${failure.reason} (the unique slot is held by another owner)`);
    case 'idempotency_conflict':
      return reject('idempotency_conflict', failure.reason);
    case 'not_found':
      return notFound(failure.reason);
    case 'invalid':
      return invalid(failure.reason);
    case 'unsupported':
      return unsupported(failure.reason);
    default:
      return unavailable(failure.reason);
  }
}

// --------------------------------------------------------------------------
// Synchronous input isolation
// --------------------------------------------------------------------------

type HostPrincipal = Extract<CorePrincipal, { kind: 'host' }>;
type HostReader = Extract<MaterialReader, { kind: 'host' }>;
type BoundContext = {
  projectId: string;
  workspaceId: string;
  principal: HostPrincipal;
  materialReader: HostReader;
  signal: AbortSignal;
};

type OwnedContext = { ok: true; ctx: BoundContext; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { ok: false; rejection: CoreRejection };

/** Binds the trusted Host scope/identity before the first await; the
 * AbortSignal is preserved by reference so cancellation is never lost. */
function ownCallContext(ctx: unknown): OwnedContext {
  if (!isRecord(ctx)) return { ok: false, rejection: forbidden('a material grant requires a bound call context') };
  const projectId = ctx['projectId'];
  const workspaceId = ctx['workspaceId'];
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: forbidden('a material grant requires a bound project/workspace context') };
  }
  const signal = ctx['signal'];
  if (!isSignal(signal)) {
    return { ok: false, rejection: forbidden('a material grant requires the bound AbortSignal') };
  }
  const principal = ctx['principal'];
  const reader = ctx['materialReader'];
  if (!isRecord(principal) || principal['kind'] !== 'host' || !trustedActor(principal['actor'])) {
    return { ok: false, rejection: forbidden('material grant/revoke requires a trusted Host principal') };
  }
  if (!isRecord(reader) || reader['kind'] !== 'host'
    || reader['projectId'] !== projectId || reader['workspaceId'] !== workspaceId
    || !sameActor(reader['actor'], principal['actor'])) {
    return { ok: false, rejection: forbidden('the material reader is not the same trusted Host scope') };
  }
  const actor = principal['actor'] as Extract<ActorRef, { kind: 'human' | 'system' }>;
  return {
    ok: true,
    ctx: {
      projectId, workspaceId,
      principal: principal as unknown as HostPrincipal,
      materialReader: reader as unknown as HostReader,
      signal,
    },
    actor: { kind: actor.kind, id: actor.id },
  };
}

type OwnedGrantRequest = { ok: true; input: GrantMaterialAccessInput; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

function ownGrantRequest(request: unknown): OwnedGrantRequest {
  if (!isRecord(request) || !isRecord(request['input']) || !isRecord(request['meta'])) {
    return { ok: false, rejection: invalid('a material grant requires an input object and request metadata') };
  }
  const meta = request['meta'];
  if (!nonEmpty(meta['requestId'])) return { ok: false, rejection: invalid('a material grant requires meta.requestId') };
  if (!Array.isArray(meta['expected'])) return { ok: false, rejection: invalid('meta.expected must be an array of version pins') };
  try {
    return {
      ok: true,
      input: structuredClone(request['input']) as GrantMaterialAccessInput,
      requestId: meta['requestId'],
      expected: structuredClone(meta['expected']) as VersionPin[],
    };
  } catch {
    return { ok: false, rejection: invalid('the material grant request cannot be isolated from the caller') };
  }
}

type OwnedRevokeRequest = { ok: true; input: RevokeMaterialAccessInput; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

function ownRevokeRequest(request: unknown): OwnedRevokeRequest {
  if (!isRecord(request) || !isRecord(request['input']) || !isRecord(request['meta'])) {
    return { ok: false, rejection: invalid('a material revocation requires an input object and request metadata') };
  }
  const meta = request['meta'];
  if (!nonEmpty(meta['requestId'])) return { ok: false, rejection: invalid('a material revocation requires meta.requestId') };
  if (!Array.isArray(meta['expected'])) return { ok: false, rejection: invalid('meta.expected must be an array of version pins') };
  try {
    return {
      ok: true,
      input: structuredClone(request['input']) as RevokeMaterialAccessInput,
      requestId: meta['requestId'],
      expected: structuredClone(meta['expected']) as VersionPin[],
    };
  } catch {
    return { ok: false, rejection: invalid('the material revocation request cannot be isolated from the caller') };
  }
}

// --------------------------------------------------------------------------
// Shape validation
// --------------------------------------------------------------------------

type ValidatedGrant = {
  goalRef: GoalRef;
  reader: RunRef;
  materials: ArtifactRef[];
  sourceSet: MaterialGrantWorkspaceSourceSet;
  purpose: string;
};

function rejectUnknownFields(record: Record<string, unknown>, allowed: readonly string[], what: string): CoreRejection | null {
  if (!allowed.every((key) => key in record)) return invalid(`${what} is missing a required field`);
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    return invalid(`${what} carries fields the service must derive itself: ${extra.join(', ')}`);
  }
  return null;
}

function validateGrantShape(input: GrantMaterialAccessInput, scope: MaterialAccessScopeV1): { ok: true; value: ValidatedGrant } | { ok: false; rejection: CoreRejection } {
  const record = input as unknown as Record<string, unknown>;
  const fieldError = rejectUnknownFields(record, GRANT_INPUT_KEYS, 'the material grant request');
  if (fieldError !== null) return { ok: false, rejection: fieldError };
  const goalRef = record['goalRef'];
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal'
    || !nonEmpty(goalRef['projectId']) || !nonEmpty(goalRef['goalId'])) {
    return { ok: false, rejection: invalid('a material grant requires a complete GoalRef') };
  }
  if (goalRef['projectId'] !== scope.projectId) {
    return { ok: false, rejection: forbidden('the Goal belongs to another project') };
  }
  const reader = record['reader'];
  if (!isRecord(reader) || !nonEmpty(reader['projectId']) || !nonEmpty(reader['goalId']) || !nonEmpty(reader['runId'])) {
    return { ok: false, rejection: invalid('a material grant requires a complete reader RunRef') };
  }
  if (reader['aggregateType'] !== 'Run') {
    return { ok: false, rejection: forbidden('only a Run reader is supported in this batch') };
  }
  if (reader['projectId'] !== scope.projectId) {
    return { ok: false, rejection: forbidden('the reader belongs to another project') };
  }
  if (reader['goalId'] !== goalRef['goalId']) {
    return { ok: false, rejection: forbidden('the reader is not in the grant Goal') };
  }
  const materials = record['materials'];
  if (!Array.isArray(materials) || materials.length < 1 || materials.length > MATERIAL_GRANT_MAX_MATERIALS) {
    return { ok: false, rejection: invalid(`materials must be 1..${MATERIAL_GRANT_MAX_MATERIALS} exact ArtifactRefs`) };
  }
  const accepted: ArtifactRef[] = [];
  for (const material of materials) {
    if (!isArtifactRef(material)) {
      return { ok: false, rejection: invalid('every material must be a complete ArtifactRef') };
    }
    if (accepted.some((existing) => sameArtifactRef(existing, material))) {
      return { ok: false, rejection: invalid('the grant materials contain a duplicate material identity') };
    }
    accepted.push(material);
  }
  const purpose = record['purpose'];
  if (!nonEmpty(purpose) || Buffer.byteLength(purpose, 'utf8') > MATERIAL_GRANT_PURPOSE_MAX_BYTES) {
    return { ok: false, rejection: invalid(`purpose must be non-empty and at most ${MATERIAL_GRANT_PURPOSE_MAX_BYTES} UTF-8 bytes`) };
  }
  const sourceSet = record['sourceSet'];
  if (!isRecord(sourceSet)) {
    return { ok: false, rejection: invalid('a material grant requires a workspace_paths source set') };
  }
  if (sourceSet['kind'] === 'verification_workspace') {
    return { ok: false, rejection: unsupported('verification_workspace needs a typed verification provider, not the ordinary workspace source provider') };
  }
  if (!validMaterialSourceSet(sourceSet) || sourceSet['kind'] !== 'workspace_paths') {
    return { ok: false, rejection: invalid('the source set must be an ordered, unique workspace_paths selection') };
  }
  return {
    ok: true,
    value: {
      goalRef: goalRef as unknown as GoalRef,
      reader: reader as unknown as RunRef,
      materials: accepted,
      sourceSet: sourceSet as unknown as MaterialGrantWorkspaceSourceSet,
      purpose,
    },
  };
}

function validateGrantExpected(
  expected: readonly VersionPin[],
  goalRef: GoalRef,
  boundWorkspaceRef: WorkspaceRef,
): { ok: true; goal: VersionPin; workspace: VersionPin } | { ok: false; rejection: CoreRejection } {
  if (expected.length !== 2) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly the Goal and Workspace pins') };
  }
  for (const pin of expected) {
    if (!isRecord(pin) || !isRecord(pin['ref']) || !isSafeRevision(pin['revision']) || pin['revision'] < 1) {
      return { ok: false, rejection: invalid('every expected pin needs a ref and a positive safe revision') };
    }
  }
  const goalKey = refKeyOf(goalRef);
  const goalIndex = expected.findIndex((pin) => refKeyOf(pin.ref) === goalKey);
  if (goalIndex < 0) {
    return { ok: false, rejection: invalid('meta.expected must identify the Goal being granted') };
  }
  const workspacePins = expected.filter((pin) => isRecord(pin.ref) && pin.ref['aggregateType'] === 'Workspace');
  if (workspacePins.length !== 1) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly one Workspace pin') };
  }
  const workspacePin = workspacePins[0]!;
  const workspaceRef = workspacePin.ref as unknown as WorkspaceRef;
  if (workspaceRef.projectId !== boundWorkspaceRef.projectId) {
    return { ok: false, rejection: invalid('the Workspace pin belongs to another project') };
  }
  if (workspaceRef.workspaceId !== boundWorkspaceRef.workspaceId) {
    return { ok: false, rejection: forbidden('the Workspace pin is outside the bound Host workspace') };
  }
  return { ok: true, goal: expected[goalIndex]!, workspace: workspacePin };
}

function validateRevokeShape(
  input: RevokeMaterialAccessInput,
  scope: MaterialAccessScopeV1,
): { ok: true; grantRef: MaterialAccessGrantRef; reason: string } | { ok: false; rejection: CoreRejection } {
  const record = input as unknown as Record<string, unknown>;
  const fieldError = rejectUnknownFields(record, REVOKE_INPUT_KEYS, 'the material revocation request');
  if (fieldError !== null) return { ok: false, rejection: fieldError };
  const grantRef = record['grantRef'];
  if (!isRecord(grantRef) || grantRef['aggregateType'] !== 'MaterialAccessGrant'
    || !nonEmpty(grantRef['projectId']) || !nonEmpty(grantRef['workspaceId'])
    || !nonEmpty(grantRef['goalId']) || !nonEmpty(grantRef['grantId'])) {
    return { ok: false, rejection: invalid('a material revocation requires a complete MaterialAccessGrantRef') };
  }
  if (grantRef['projectId'] !== scope.projectId) {
    return { ok: false, rejection: forbidden('the grant belongs to another project') };
  }
  if (grantRef['workspaceId'] !== scope.workspaceId) {
    return { ok: false, rejection: forbidden('the grant belongs to another workspace') };
  }
  const reason = record['reason'];
  if (!nonEmpty(reason) || Buffer.byteLength(reason, 'utf8') > MATERIAL_GRANT_REASON_MAX_BYTES) {
    return { ok: false, rejection: invalid(`reason must be non-empty and at most ${MATERIAL_GRANT_REASON_MAX_BYTES} UTF-8 bytes`) };
  }
  return { ok: true, grantRef: grantRef as unknown as MaterialAccessGrantRef, reason };
}

function validateRevokeExpected(
  expected: readonly VersionPin[],
  grantRef: MaterialAccessGrantRef,
): { ok: true } | { ok: false; rejection: CoreRejection } {
  if (expected.length !== 1) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly the grant revision-1 pin') };
  }
  const pin = expected[0]!;
  if (!isRecord(pin) || !isRecord(pin['ref']) || pin['revision'] !== 1 || refKeyOf(pin.ref) !== refKeyOf(grantRef)) {
    return { ok: false, rejection: invalid('meta.expected must pin this grant at revision 1') };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Identity and fingerprint
// --------------------------------------------------------------------------

function actorIdentity(actor: Extract<ActorRef, { kind: 'human' | 'system' }>): { kind: string; id: string } {
  return { kind: actor.kind, id: actor.id };
}

function stableDigest(
  operation: 'grant' | 'revoke',
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
  scope: MaterialAccessScopeV1,
  requestId: string,
): string {
  return sha256Hex(canonicalJson({
    operation, actor: actorIdentity(actor), projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId: scope.goalId, requestId,
  } as unknown as JsonValue));
}

function sortedExpected(expected: readonly VersionPin[]): unknown[] {
  return [...expected]
    .map((pin) => ({ ref: pin.ref, revision: pin.revision }))
    .sort((left, right) => {
      const leftKey = refKeyOf(left.ref);
      const rightKey = refKeyOf(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

function grantFingerprint(
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
  scope: MaterialAccessScopeV1,
  input: ValidatedGrant,
  expected: readonly VersionPin[],
): string {
  return sha256Hex(canonicalJson({
    kind: 'material-access-grant-request', operation: 'grant', actor: actorIdentity(actor),
    projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId,
    goalRef: input.goalRef, reader: input.reader, materials: input.materials,
    sourceSet: input.sourceSet, purpose: input.purpose, expected: sortedExpected(expected),
  } as unknown as JsonValue));
}

function revokeFingerprint(
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
  scope: MaterialAccessScopeV1,
  grantRef: MaterialAccessGrantRef,
  reason: string,
  expected: readonly VersionPin[],
): string {
  return sha256Hex(canonicalJson({
    kind: 'material-access-revoke-request', operation: 'revoke', actor: actorIdentity(actor),
    projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: scope.goalId,
    grantRef, reason, expected: sortedExpected(expected),
  } as unknown as JsonValue));
}

// --------------------------------------------------------------------------
// Canonical reads
// --------------------------------------------------------------------------

type AuthorityLoad = Awaited<ReturnType<MaterialGrantDependencies['authority']['load']>>;

function authorityRejection(result: Exclude<AuthorityLoad, { status: 'found' }>): CoreRejection {
  return result.status === 'not_found'
    ? notFound('the requested canonical record does not exist')
    : unavailable(result.reason);
}

function runScopeProblem(run: RunSnapshot, reader: RunRef, scope: MaterialAccessScopeV1): CoreRejection | null {
  if (!sameRef(run.ref, reader)) return unavailable('the canonical reader load did not return the requested RunRef');
  if (run.task.projectId !== scope.projectId || run.task.goalId !== scope.goalId) {
    return forbidden('the reader Run task is outside the grant Goal');
  }
  if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
    return forbidden('the reader Run is outside the grant workspace');
  }
  return null;
}

/** Loads and scope-checks the canonical owner Run behind a stored material. */
async function loadOwnerRun(
  authority: MaterialGrantDependencies['authority'],
  owner: ArtifactOwnerRunRef,
  scope: MaterialAccessScopeV1,
): Promise<{ ok: true; run: RunSnapshot } | { ok: false; rejection: CoreRejection }> {
  if (owner.aggregateType !== 'Run') {
    return { ok: false, rejection: forbidden('only a Run owner is admissible for a current material grant') };
  }
  if (owner.projectId !== scope.projectId || owner.goalId !== scope.goalId) {
    return { ok: false, rejection: forbidden('the material owner is outside the grant Goal') };
  }
  const canonical = await authority.load(owner);
  if (canonical.status !== 'found') return { ok: false, rejection: authorityRejection(canonical) };
  const run = canonical.snapshot as RunSnapshot;
  if (!sameRef(run.ref, owner)) {
    return { ok: false, rejection: forbidden('the canonical owner load did not return the requested RunRef') };
  }
  if (run.workspaceSnapshot.workspaceId !== scope.workspaceId) {
    return { ok: false, rejection: forbidden('the material owner is outside the grant workspace') };
  }
  if (run.task.projectId !== scope.projectId || run.task.goalId !== scope.goalId) {
    return { ok: false, rejection: forbidden('the material owner task is outside the grant scope') };
  }
  return { ok: true, run };
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createMaterialGrantService(deps: MaterialGrantDependencies): MaterialGrantPort {
  const records: GoalRecordTransactionPort = deps.records;

  function recordOf(snapshot: MaterialAccessGrantSnapshot): EncodedRecord {
    return encodeMaterialAccessGrantSnapshot(snapshot);
  }

  type RestoreReceipt = (receipt: CommittedReceipt) => Promise<WriteResult<MaterialAccessGrantSnapshot>>;

  /** A durable receipt exists only if the SAME identity/fingerprint is found.
   * Any other result leaves the outcome explicitly unknown; this never retries
   * the write and never fabricates a commit. */
  async function recoverUnknownCommit(
    prepared: PreparedCommit,
    restore: RestoreReceipt,
    what: 'grant' | 'revoke',
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    let lookup: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
    try {
      lookup = await records.lookupCommit({ identityKey: prepared.identityKey, fingerprint: prepared.fingerprint });
    } catch {
      return unavailable(`the ${what} commit outcome is unknown: the durable receipt could not be read`);
    }
    if (lookup.status !== 'ready') {
      return unavailable(`the ${what} commit outcome is unknown: no durable receipt was confirmed`);
    }
    try {
      return await restore(lookup.value);
    } catch {
      return unavailable(`the ${what} commit outcome is unknown: the durable receipt could not be restored`);
    }
  }

  /** The single commit boundary shared by both writers. A thrown transport error
   * or an `unavailable` Store result does not prove the write did not happen, so
   * recovery is attempted ONLY from that identity's durable receipt plus a
   * strictly matching stored event; otherwise the result stays explicitly
   * unknown. A concurrently-replayed commit is restored from its stored event
   * rather than from this call's prospective snapshot. */
  async function commitWithRecovery(
    prepared: PreparedCommit,
    restore: RestoreReceipt,
    freshValue: MaterialAccessGrantSnapshot,
    what: 'grant' | 'revoke',
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    let receipt: StoreCommitReceipt;
    try {
      receipt = await records.commit(prepared);
    } catch {
      return recoverUnknownCommit(prepared, restore, what);
    }
    if (receipt.status === 'committed') {
      if (receipt.replayed) {
        try {
          return await restore(receipt);
        } catch {
          return unavailable(`the ${what} replay event could not be restored`);
        }
      }
      return { status: 'committed', value: freshValue, replayed: false, cursor: receipt.cursor };
    }
    if (receipt.code === 'unavailable') return recoverUnknownCommit(prepared, restore, what);
    return mapStoreFailure(receipt);
  }

  async function grantMaterialAccess(
    ctx: CoreCallContext,
    request: GraphWrite<GrantMaterialAccessInput>,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    const ownedCtx = ownCallContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const bound = ownedCtx.ctx;
    const actor = ownedCtx.actor;
    const ownedRequest = ownGrantRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest;

    const scope: MaterialAccessScopeV1 = { projectId: bound.projectId, workspaceId: bound.workspaceId, goalId: '' };
    // The Goal pin is validated before it can supply the goalId; validate shape
    // first so a forged aggregate never reaches a read.
    const shape = validateGrantShape(input, scope);
    if (!shape.ok) return shape.rejection;
    const validated = shape.value;
    scope.goalId = validated.goalRef.goalId;

    const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: bound.projectId, workspaceId: bound.workspaceId };
    const checkedExpected = validateGrantExpected(expected, validated.goalRef, workspaceRef);
    if (!checkedExpected.ok) return checkedExpected.rejection;

    const digest = stableDigest('grant', actor, scope, requestId);
    const identityKey = GRANT_IDENTITY_PREFIX + digest;
    const grantId = `mag-${digest}`;
    const fingerprint = grantFingerprint(actor, scope, validated, expected);
    if (bound.signal.aborted) return cancelled('the material grant was cancelled before lookup');

    // 1. Original receipt first: a replay must not consult the current world.
    const lookup = await records.lookupCommit({ identityKey, fingerprint });
    if (lookup.status === 'ready') return readGrantReceipt(lookup.value, actor, scope, identityKey, fingerprint, validated);
    if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
    if (bound.signal.aborted) return cancelled('the material grant was cancelled during lookup');

    // 2. Current Goal / Workspace / reader Run.
    const goalRead = await deps.authority.load(validated.goalRef);
    if (goalRead.status !== 'found') return authorityRejection(goalRead);
    const goal = goalRead.snapshot as GoalSnapshot;
    if (!sameRef(goal.ref, validated.goalRef)) return unavailable('the Goal read returned another GoalRef');
    if (goal.workspaceRef.projectId !== scope.projectId || goal.workspaceRef.workspaceId !== scope.workspaceId) {
      return forbidden('the Goal is outside the grant workspace');
    }
    if (goal.activePlanRevision === null) return revisionConflict('the Goal has no accepted active Plan');
    if (bound.signal.aborted) return cancelled('the material grant was cancelled during the goal read');

    const workspaceRead = await deps.authority.load(workspaceRef);
    if (workspaceRead.status !== 'found') return authorityRejection(workspaceRead);
    const workspace = workspaceRead.snapshot as WorkspaceSnapshot;
    if (!sameRef(workspace.ref, workspaceRef)) return unavailable('the Workspace read returned another WorkspaceRef');
    if (bound.signal.aborted) return cancelled('the material grant was cancelled during the workspace read');

    const readerRead = await deps.authority.load(validated.reader);
    if (readerRead.status !== 'found') return authorityRejection(readerRead);
    const readerRun = readerRead.snapshot as RunSnapshot;
    const readerProblem = runScopeProblem(readerRun, validated.reader, scope);
    if (readerProblem !== null) return readerProblem;
    if (!sameRef(readerRun.planRef, goal.activePlanRevision)) {
      return revisionConflict('the reader Run Plan is not the Goal current accepted Plan');
    }
    if (bound.signal.aborted) return cancelled('the material grant was cancelled during the reader read');

    // 3. Each exact material through the real Host historical read, then the
    //    canonical owner Run behind the ACTUAL returned ownerRunRef.
    const ownerRefs = new Map<string, ArtifactOwnerRunRef>();
    for (const material of validated.materials) {
      if (bound.signal.aborted) return cancelled('the material grant was cancelled during material reads');
      const opened = await deps.materials.openArtifact(bound as unknown as CoreCallContext, {
        ref: material, usage: 'historical_explanation',
      });
      if (opened.status === 'not_found') return notFound('a granted material body does not exist');
      if (opened.status === 'rejected') return reject(opened.code, opened.reason);
      if (opened.status === 'not_ready') return unavailable('the material read is not ready at a required watermark');
      const record = opened.value;
      if (!sameRef(record.ref, material)) {
        return unavailable('the stored material ref does not match the requested ArtifactRef');
      }
      if (artifactBodyDigest(record.body) !== material.digest || artifactBodySize(record.body) !== material.sizeBytes) {
        return unavailable('the stored material body does not match its content-addressed ref');
      }
      const owner = record.ownerRunRef;
      if (owner === undefined || owner === null) {
        return forbidden('the material has no canonical Run owner to scope a current grant');
      }
      // ownerRefs is the pass-local verified-owner set, never a place to trust a
      // body's self-reported owner: an owner is inserted only after loadOwnerRun
      // has proven that exact RunRef. A later material reporting the same complete
      // owner RunRef reuses that proof, so the first-pass authority reads drop
      // from one per material to one per unique owner. The post-capture re-read
      // (below) remains one real read per unique owner and is never served here.
      const ownerKey = refKeyOf(owner);
      if (!ownerRefs.has(ownerKey)) {
        const verified = await loadOwnerRun(deps.authority, owner, scope);
        if (!verified.ok) return verified.rejection;
        ownerRefs.set(ownerKey, owner);
      }
    }

    // 4. Real source capture for the exact workspace_paths selection.
    let captured;
    try {
      captured = await deps.source.capture(
        { projectId: scope.projectId, workspaceId: scope.workspaceId, sourceSet: validated.sourceSet },
        bound.signal,
      );
    } catch (error) {
      return unavailable('the source provider failed: ' + messageOf(error));
    }
    if (captured.status !== 'sourced') {
      const issues = captured.issues.join('; ');
      if (captured.status === 'unavailable') return unavailable(issues || 'source is unavailable');
      if (captured.status === 'rejected') return forbidden(issues || 'source capture was rejected');
      return reject('source_stale', issues || 'source changed during capture');
    }
    const pin = captured.pin;
    if (!validMaterialSourcePin(pin)
      || pin.projectId !== scope.projectId || pin.workspaceId !== scope.workspaceId
      || canonicalJson(pin.sourceSet) !== canonicalJson(validated.sourceSet)) {
      return reject('source_stale', 'the captured source pin is not the exact requested source set');
    }
    if (bound.signal.aborted) return cancelled('the material grant was cancelled after source capture');

    // 5. Re-read every formal fact after the source I/O; one consistent scope.
    const goalAfterRead = await deps.authority.load(validated.goalRef);
    if (goalAfterRead.status !== 'found') return authorityRejection(goalAfterRead);
    const goalAfter = goalAfterRead.snapshot as GoalSnapshot;
    if (!sameRef(goalAfter.ref, validated.goalRef)) return unavailable('the Goal read returned another GoalRef');
    if (goalAfter.workspaceRef.projectId !== scope.projectId || goalAfter.workspaceRef.workspaceId !== scope.workspaceId) {
      return forbidden('the Goal is outside the grant workspace');
    }
    if (goalAfter.revision !== checkedExpected.goal.revision) {
      return revisionConflict('the Goal changed since the caller read it');
    }
    if (goalAfter.activePlanRevision === null || !sameRef(goalAfter.activePlanRevision, readerRun.planRef)) {
      return revisionConflict('the reader Run Plan is no longer the Goal current accepted Plan');
    }

    const workspaceAfterRead = await deps.authority.load(workspaceRef);
    if (workspaceAfterRead.status !== 'found') return authorityRejection(workspaceAfterRead);
    const workspaceAfter = workspaceAfterRead.snapshot as WorkspaceSnapshot;
    if (!sameRef(workspaceAfter.ref, workspaceRef)) return unavailable('the Workspace read returned another WorkspaceRef');
    if (workspaceAfter.revision !== checkedExpected.workspace.revision) {
      return revisionConflict('the Workspace changed since the caller read it');
    }

    const readerAfterRead = await deps.authority.load(validated.reader);
    if (readerAfterRead.status !== 'found') return authorityRejection(readerAfterRead);
    const readerAfter = readerAfterRead.snapshot as RunSnapshot;
    const readerAfterProblem = runScopeProblem(readerAfter, validated.reader, scope);
    if (readerAfterProblem !== null) return readerAfterProblem;
    if (!sameRef(readerAfter.planRef, goalAfter.activePlanRevision)) {
      return revisionConflict('the reader Run Plan is no longer the Goal current accepted Plan');
    }

    const ownerGuards = new Map<string, number>();
    for (const [key, owner] of ownerRefs) {
      const verified = await loadOwnerRun(deps.authority, owner, scope);
      if (!verified.ok) return verified.rejection;
      ownerGuards.set(key, verified.run.revision);
    }
    if (bound.signal.aborted) return cancelled('the material grant was cancelled before commit');

    // 6. One CAS@0 grant snapshot plus the replay event.
    const grantedAt = deps.now();
    if (!nonEmpty(grantedAt) || !Number.isFinite(Date.parse(grantedAt))) {
      return invalid('the injected clock is not a legal instant');
    }
    const eventId = deps.eventId();
    if (!nonEmpty(eventId)) return unsupported('the injected id source produced an empty identity');

    const basis: MaterialBasisV1 = {
      planRef: readerAfter.planRef,
      workspaceRevision: workspaceAfter.revision,
      sourceDigest: pin.manifestDigest,
      sourcePin: pin,
    };
    const grantRef: MaterialAccessGrantRef = {
      aggregateType: 'MaterialAccessGrant', projectId: scope.projectId, workspaceId: scope.workspaceId,
      goalId: scope.goalId, grantId,
    };
    const grant: MaterialAccessGrantV1 = {
      schemaVersion: 1, grantId, scope, materials: validated.materials, reader: validated.reader,
      issuedBy: { aggregateType: 'Control', projectId: scope.projectId, goalId: scope.goalId },
      purpose: validated.purpose, basis, grantedAt,
    };
    const snapshot: MaterialAccessGrantSnapshot = { ref: grantRef, revision: 1, schemaVersion: 1, grant };
    const event: MaterialAccessGrantedEvent = {
      eventId, eventType: MATERIAL_ACCESS_GRANTED_EVENT, schemaVersion: MATERIAL_ACCESS_GRANTED_SCHEMA_VERSION,
      projectId: scope.projectId, workspaceId: scope.workspaceId, aggregateType: 'MaterialAccessGrant',
      aggregateId: grantId, aggregateRevision: 1, causationId: requestId, correlationId: requestId,
      idempotencyKey: identityKey, fingerprint, actor, occurredAt: grantedAt, payload: { snapshot },
    };

    const guardMap = new Map<string, number | null>();
    const addGuard = (refKey: string, expectedRevision: number | null): void => {
      const existing = guardMap.get(refKey);
      if (existing === undefined || (existing === null && expectedRevision !== null)) guardMap.set(refKey, expectedRevision);
    };
    addGuard(refKeyOf(validated.goalRef), goalAfter.revision);
    addGuard(refKeyOf(workspaceRef), workspaceAfter.revision);
    addGuard(refKeyOf(validated.reader), readerAfter.revision);
    addGuard(refKeyOf(grantRef), null);
    for (const [key, revision] of ownerGuards) addGuard(key, revision);
    const guards: RecordGuard[] = [...guardMap].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));

    const prepared: PreparedCommit = {
      identityKey, fingerprint, guards, records: [recordOf(snapshot)], claims: [],
      indexGuards: [], indexChanges: [], events: [encodeMaterialAccessGrantedEvent(event)],
    };
    return commitWithRecovery(
      prepared,
      (receipt) => readGrantReceipt(receipt, actor, scope, identityKey, fingerprint, validated),
      snapshot,
      'grant',
    );
  }

  async function readGrantReceipt(
    receipt: CommittedReceipt,
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: MaterialAccessScopeV1,
    identityKey: string,
    fingerprint: string,
    input: ValidatedGrant,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded grant receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    const decoded = decodeMaterialAccessGrantedEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded grant event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return unavailable('the recorded event id disagrees with the grant receipt');
    if (event.idempotencyKey !== identityKey || event.fingerprint !== fingerprint) {
      return unavailable('the recorded grant identity/fingerprint disagrees with the idempotency receipt');
    }
    if (!sameActor(event.actor, actor)) return unavailable('the recorded grant event belongs to another actor');
    if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
      return unavailable('the recorded grant scope disagrees with the request');
    }
    const snapshot = event.payload.snapshot;
    if (snapshot.ref.projectId !== scope.projectId || snapshot.ref.workspaceId !== scope.workspaceId
      || snapshot.ref.goalId !== scope.goalId || snapshot.ref.grantId !== event.aggregateId) {
      return unavailable('the recorded grant ref disagrees with the request scope');
    }
    if (canonicalJson(snapshot.grant.reader) !== canonicalJson(input.reader)
      || canonicalJson(snapshot.grant.materials) !== canonicalJson(input.materials)) {
      return unavailable('the recorded grant reader/materials disagree with the request');
    }
    return { status: 'committed', value: snapshot, replayed: true, cursor: receipt.cursor };
  }

  async function revokeMaterialAccess(
    ctx: CoreCallContext,
    request: GraphWrite<RevokeMaterialAccessInput>,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    const ownedCtx = ownCallContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const bound = ownedCtx.ctx;
    const actor = ownedCtx.actor;
    const ownedRequest = ownRevokeRequest(request);
    if (!ownedRequest.ok) return ownedRequest.rejection;
    const { input, requestId, expected } = ownedRequest;

    const scope: MaterialAccessScopeV1 = { projectId: bound.projectId, workspaceId: bound.workspaceId, goalId: '' };
    const shape = validateRevokeShape(input, scope);
    if (!shape.ok) return shape.rejection;
    const grantRef = shape.grantRef;
    scope.goalId = grantRef.goalId;
    const checkedExpected = validateRevokeExpected(expected, grantRef);
    if (!checkedExpected.ok) return checkedExpected.rejection;

    const digest = stableDigest('revoke', actor, scope, requestId);
    const identityKey = REVOKE_IDENTITY_PREFIX + digest;
    const fingerprint = revokeFingerprint(actor, scope, grantRef, shape.reason, expected);
    if (bound.signal.aborted) return cancelled('the material revocation was cancelled before lookup');

    const lookup = await records.lookupCommit({ identityKey, fingerprint });
    if (lookup.status === 'ready') return readRevokeReceipt(lookup.value, actor, grantRef, identityKey, fingerprint);
    if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
    if (bound.signal.aborted) return cancelled('the material revocation was cancelled during lookup');

    // Revocation never requires the source/Plan/basis to still be current.
    const canonical = await deps.authority.load(grantRef);
    if (canonical.status !== 'found') return authorityRejection(canonical);
    const snapshot = canonical.snapshot as MaterialAccessGrantSnapshot;
    if (!sameRef(snapshot.ref, grantRef)) return unavailable('the canonical grant load returned another MaterialAccessGrantRef');
    if (snapshot.revision === 2 || snapshot.revocation !== undefined) {
      return revisionConflict('the grant is already revoked');
    }
    if (snapshot.revision !== 1) return revisionConflict('the recorded grant is not at revision 1');
    if (bound.signal.aborted) return cancelled('the material revocation was cancelled before commit');

    const revokedAt = deps.now();
    if (!nonEmpty(revokedAt) || !Number.isFinite(Date.parse(revokedAt))) {
      return invalid('the injected clock is not a legal instant');
    }
    const eventId = deps.eventId();
    if (!nonEmpty(eventId)) return unsupported('the injected id source produced an empty identity');
    const revocation: MaterialAccessRevocationV1 = { reason: shape.reason, revokedAt, actor, commandId: requestId };
    const revoked: MaterialAccessGrantSnapshot = { ...snapshot, revision: 2, revocation };
    const event: MaterialAccessRevokedEvent = {
      eventId, eventType: MATERIAL_ACCESS_REVOKED_EVENT, schemaVersion: MATERIAL_ACCESS_REVOKED_SCHEMA_VERSION,
      projectId: scope.projectId, workspaceId: scope.workspaceId, aggregateType: 'MaterialAccessGrant',
      aggregateId: grantRef.grantId, aggregateRevision: 2, causationId: requestId, correlationId: requestId,
      idempotencyKey: identityKey, fingerprint, actor, occurredAt: revokedAt, payload: { snapshot: revoked },
    };
    const prepared: PreparedCommit = {
      identityKey, fingerprint, guards: [{ refKey: refKeyOf(grantRef), expectedRevision: 1 }],
      records: [recordOf(revoked)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodeMaterialAccessRevokedEvent(event)],
    };
    return commitWithRecovery(
      prepared,
      (receipt) => readRevokeReceipt(receipt, actor, grantRef, identityKey, fingerprint),
      revoked,
      'revoke',
    );
  }

  async function readRevokeReceipt(
    receipt: CommittedReceipt,
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    grantRef: MaterialAccessGrantRef,
    identityKey: string,
    fingerprint: string,
  ): Promise<WriteResult<MaterialAccessGrantSnapshot>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the recorded revocation receipt does not name exactly one event');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    const decoded = decodeMaterialAccessRevokedEvent(at.value.event);
    if (decoded.status !== 'decoded') return unavailable(`the recorded revocation event is not decodable: ${decoded.reason}`);
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return unavailable('the recorded event id disagrees with the revocation receipt');
    if (event.idempotencyKey !== identityKey || event.fingerprint !== fingerprint) {
      return unavailable('the recorded revocation identity/fingerprint disagrees with the idempotency receipt');
    }
    if (!sameActor(event.actor, actor)) return unavailable('the recorded revocation event belongs to another actor');
    if (event.aggregateId !== grantRef.grantId) return unavailable('the recorded revocation belongs to another grant');
    const snapshot = event.payload.snapshot;
    if (snapshot.revision !== 2 || snapshot.revocation === undefined) {
      return unavailable('the recorded revocation event does not carry a revoked snapshot');
    }
    if (!sameRef(snapshot.ref, grantRef)) return unavailable('the recorded revocation ref disagrees with the request');
    return { status: 'committed', value: snapshot, replayed: true, cursor: receipt.cursor };
  }

  return { grantMaterialAccess, revokeMaterialAccess };
}
